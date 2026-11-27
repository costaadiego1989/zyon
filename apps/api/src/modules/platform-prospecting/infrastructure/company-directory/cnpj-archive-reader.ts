import { createHash } from "node:crypto";
import { mkdtemp, open, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, dirname, basename } from "node:path";
import { crc32 } from "node:zlib";
import yauzl from "yauzl";
import iconv from "iconv-lite";
import Papa from "papaparse";
import type { CompanySourceResource } from "@zyon/shared-types";
import { canonicalCnpj } from "../../domain/company-directory/cnpj.js";
import type { DirectoryArchivePort, DirectoryDecodedRow, PreparedDirectoryArchive } from "../../domain/prospecting.ports.js";

interface ArchiveLimits { importMaximumFileBytes: number; importMaximumExpandedBytes: number; importMaximumEntries: number; importMaximumLineBytes: number; importMaximumMemoryBytes: number; importMinimumFreeDiskBytes: number }
function removeOwnedArchive(directory:string):Promise<void>{
  const temporaryRoot=resolve(tmpdir());const target=resolve(directory);const child=relative(temporaryRoot,target);
  if(dirname(target)!==temporaryRoot||!/^zyon-cnpj-[A-Za-z0-9]+$/.test(basename(target))||child.startsWith(".."))throw new Error("archive_cleanup_path_invalid");
  return rm(target,{recursive:true,force:true});
}
const nullable = (value: string) => value.trim() || null;
function base(value: string) { if (!/^[A-Za-z0-9]{8}$/.test(value)) throw new Error("invalid_cnpj"); return value.toUpperCase(); }
function money(value: string) {
  if (!value) return null;
  if (!/^\d+(?:,\d{2})?$/.test(value)) throw new Error("archive_layout_invalid:capital");
  const [whole, cents = "00"] = value.split(","); return (BigInt(whole) * 100n + BigInt(cents)).toString();
}
function tax(value: string) { if (!["", "S", "N"].includes(value)) throw new Error("archive_layout_invalid:tax"); return value === "" ? null : value === "S"; }
function date(value: string) {
  if (!value || value === "00000000") return null;
  const formatted = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  if (!/^\d{8}$/.test(value) || !Number.isFinite(Date.parse(formatted)) || new Date(formatted).toISOString().slice(0,10) !== formatted) throw new Error("archive_layout_invalid:date");
  return formatted;
}
function decodeRecord(record: Buffer, family: string): DirectoryDecodedRow | null {
  const text = iconv.decode(record, "win1252").trimEnd(); if (!text.trim()) return null;
  const parsed = Papa.parse<string[]>(text, { delimiter: ";", quoteChar: '"', dynamicTyping: false, skipEmptyLines: true });
  const columns = parsed.data[0];
  const width = family === "empresas" || family === "simples" ? 7 : family === "estabelecimentos" ? 30 : ["cnaes", "municipios", "naturezas"].includes(family) ? 2 : 0;
  if (!width || parsed.errors.length || parsed.data.length !== 1 || columns.length !== width) throw new Error("archive_layout_invalid");
  try {
    if (family === "empresas") return { kind: "entity", value: { baseCnpj: base(columns[0]), legalName: columns[1], legalNature: nullable(columns[2]), size: nullable(columns[5]), capitalCents: money(columns[4]), simples: null, mei: null } };
    if (family === "simples") return { kind: "tax", value: { baseCnpj: base(columns[0]), simples: tax(columns[1]), mei: tax(columns[4]) } };
    if (family !== "estabelecimentos") return { kind: "domain", value: { kind: family, code: columns[0], label: columns[1] } };
    if (!/^[A-Za-z0-9]{4}$/.test(columns[1]) || !/^[0-9]{2}$/.test(columns[2])) throw new Error("invalid_cnpj");
    const cnpj = canonicalCnpj(base(columns[0]) + columns[1] + columns[2]);
    if (!["", "1", "2"].includes(columns[3])) throw new Error("archive_layout_invalid:matrix_branch");
    const contacts: Extract<DirectoryDecodedRow, {kind:"establishment"}>["value"]["contacts"] = [];
    for (const [ddd, number] of [[columns[21], columns[22]], [columns[23], columns[24]]]) if (number) contacts.push({ channel: "phone", originalValue: ddd + number, normalizedValue: null, validationState: "unknown" });
    if (columns[27]) contacts.push({ channel: "email", originalValue: columns[27], normalizedValue: null, validationState: "unknown" });
    return { kind: "establishment", value: { cnpj, baseCnpj: cnpj.slice(0,8), tradeName: nullable(columns[4]), mainCnae: nullable(columns[11]), secondaryCnaes: [...new Set(columns[12].split(",").filter(Boolean))], cityCode: nullable(columns[20]), uf: nullable(columns[19]), district: nullable(columns[17]), openingDate: date(columns[10]), status: nullable(columns[5]), matrixBranch: columns[3] === "1" ? "matrix" : columns[3] === "2" ? "branch" : null, contacts } };
  } catch (error) { if ((error as Error).message === "invalid_cnpj") return { kind: "rejected", errorCode: "invalid_cnpj" }; throw error; }
}
export class CnpjArchiveReader implements DirectoryArchivePort {
  constructor(private readonly source: { openResource(url: string): Promise<Response> }, private readonly limits: ArchiveLimits) {
    if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0) || limits.importMaximumLineBytes > limits.importMaximumMemoryBytes) throw new Error("config_invalid:archive_limits");
  }
  async prepare(resource: CompanySourceResource, selectRecord?: (record:Buffer,family:string)=>boolean): Promise<PreparedDirectoryArchive> {
    const directory = await mkdtemp(join(tmpdir(), "zyon-cnpj-")); const path = join(directory, "resource.zip");
    try {
      const disk = await statfs(directory, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(this.limits.importMinimumFreeDiskBytes) + BigInt(this.limits.importMaximumFileBytes)) throw new Error("archive_disk_limit");
      const response = await this.source.openResource(resource.url);
      if (!response.ok || !response.body) throw new Error("source_unavailable");
      if(resource.etag!==null?response.headers.get("etag")!==resource.etag:resource.lastModified!==null&&Date.parse(response.headers.get("last-modified")??"")!==Date.parse(resource.lastModified)){
        await response.body.cancel();throw new Error("source_changed");
      }
      const hash = createHash("sha256"); let bytes = 0;
      const file = await open(path, "wx"); const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.length; if (bytes > this.limits.importMaximumFileBytes) throw new Error("archive_download_limit");
          hash.update(chunk.value); await file.writeFile(chunk.value);
        }
      } finally { await reader.cancel(); await file.close(); }
      return { fileHash: hash.digest("hex"), compressedBytes: bytes, rows: () => this.rows(path, resource.family,selectRecord), close: () => removeOwnedArchive(directory) };
    } catch (error) { await removeOwnedArchive(directory); throw error; }
  }
  private async *rows(path: string, family: string, selectRecord?: (record:Buffer,family:string)=>boolean): AsyncGenerator<DirectoryDecodedRow> {
    let zip: yauzl.ZipFile | undefined; let expanded = 0; let count = 0;
    try {
      zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, opened) => error ? reject(error) : resolve(opened!)));
      while (true) {
        const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
          const cleanup = () => { zip!.off("entry", found); zip!.off("end", end); zip!.off("error", fail); };
          const found = (value: yauzl.Entry) => { cleanup(); resolve(value); }; const end = () => { cleanup(); resolve(null); }; const fail = (error: Error) => { cleanup(); reject(error); };
          zip!.once("entry", found); zip!.once("end", end); zip!.once("error", fail); zip!.readEntry();
        });
        if (!entry) break;
        if (++count > this.limits.importMaximumEntries) throw new Error("archive_entry_limit");
        if (/\\|(^|\/)\.\.(\/|$)|^\/|^[A-Za-z]:/.test(entry.fileName) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("archive_path_invalid");
        if (entry.fileName.endsWith("/")) continue;
        const stream = await new Promise<import("node:stream").Readable>((resolve,reject) => zip!.openReadStream(entry, (error, readable) => error ? reject(error) : resolve(readable!)));
        let crc = 0; let pending = Buffer.alloc(0); let quoted = false; let entryBytes = 0;
        try {
          for await (const raw of stream) {
            const chunk = raw as Buffer; expanded += chunk.length; entryBytes += chunk.length;
            if (expanded > this.limits.importMaximumExpandedBytes) throw new Error("archive_expansion_limit");
            crc = crc32(chunk, crc);
            let start = 0;
            for (let index = 0; index < chunk.length; index++) {
              if (chunk[index] === 34) quoted = !quoted;
              if (index - start + pending.length > this.limits.importMaximumLineBytes) throw new Error("archive_record_limit");
              if (chunk[index] === 10 && !quoted) { const record=Buffer.concat([pending, chunk.subarray(start,index)]);if(!selectRecord||selectRecord(record,family)){const row=decodeRecord(record,family);if(row)yield row;} pending = Buffer.alloc(0); start = index + 1; }
            }
            pending = Buffer.concat([pending,chunk.subarray(start)]);
            if (pending.length > this.limits.importMaximumLineBytes) throw new Error("archive_record_limit");
          }
          if (crc !== entry.crc32 || entryBytes !== entry.uncompressedSize) throw new Error("archive_corrupt:crc_or_size");
          if (pending.length&&(!selectRecord||selectRecord(pending,family))) { const row = decodeRecord(pending,family); if (row) yield row; }
        } finally { stream.destroy(); }
      }
      if (!count) throw new Error("archive_corrupt:empty");
    } catch (cause) {
      const message = (cause as Error).message;
      if (message.startsWith("archive_")) throw cause;
      throw new Error(/invalid relative path|absolute path|backslash/.test(message) ? "archive_path_invalid" : "archive_corrupt", { cause });
    } finally { zip?.close(); }
  }
}
