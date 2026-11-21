import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import iconv from "iconv-lite";
import { CnpjArchiveReader } from "./cnpj-archive-reader.js";

export function fixtureZip(content: Buffer, name = "F.K03200.CSV", deflated = false) {
  const filename = Buffer.from(name); const data = deflated ? deflateRawSync(content) : content;
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(deflated ? 8 : 0,8); header.writeUInt32LE(crc32(content),14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(content.length,22); header.writeUInt16LE(filename.length,26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20,4); directory.writeUInt16LE(20,6); directory.writeUInt16LE(deflated ? 8 : 0,10); directory.writeUInt32LE(crc32(content),16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(content.length,24); directory.writeUInt16LE(filename.length,28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(directory.length + filename.length,12); end.writeUInt32LE(header.length + filename.length + data.length,16);
  return Buffer.concat([header,filename,data,directory,filename,end]);
}
export const archiveLimits = { importMaximumFileBytes: 100_000, importMaximumExpandedBytes: 100_000, importMaximumEntries: 2, importMaximumLineBytes: 4096, importMaximumMemoryBytes: 65_536, importMinimumFreeDiskBytes: 1 };
const resource = (family: string) => ({ id: family, family, url: "https://official.invalid/test.zip", competence: "2026-11", discoveredAt: "2026-11-20T00:00:00Z", etag: null, lastModified: null });
async function rows(zip: Buffer, family: string, limits = archiveLimits) {
  const reader = new CnpjArchiveReader({ openResource: async () => new Response(zip) }, limits);
  const archive = await reader.prepare(resource(family));
  try { const result = []; for await (const row of archive.rows()) result.push(row); return result; } finally { await archive.close(); }
}
test("PROS-04 AC3 rejects stored-entry corruption retaining sizes, traversal and actual expansion beyond the ceiling", async () => {
  const good = fixtureZip(Buffer.from('"01";"arroz"\n'));
  const corrupt = Buffer.from(good); corrupt[30 + Buffer.byteLength("F.K03200.CSV") + 7] ^= 1;
  await assert.rejects(() => rows(corrupt, "cnaes"), /archive_corrupt/);
  await assert.rejects(() => rows(fixtureZip(Buffer.from("data"), "../escape.csv"), "cnaes"), /archive_path_invalid/);
  await assert.rejects(() => rows(fixtureZip(Buffer.from('"01";"' + "x".repeat(10_000) + '"\n'), "data.csv", true), "cnaes", { ...archiveLimits, importMaximumExpandedBytes: 100 }), /archive_expansion_limit/);
  await assert.rejects(() => rows(Buffer.from("not zip"), "cnaes"), /archive_corrupt/);
});
test("PROS-04 AC4 decodes the source CP1252, quotes, empty fields, explicit false and exact money", async () => {
  assert.deepEqual(await rows(fixtureZip(iconv.encode('"0111301";"Cultivo de maçã; arroz"\r\n', "win1252")), "cnaes"), [{kind:"domain",value:{kind:"cnaes",code:"0111301",label:"Cultivo de maçã; arroz"}}]);
  assert.deepEqual(await rows(fixtureZip(Buffer.from('"12ABC345";"S";"";"";"N";"";""\n"00000000";"";"";"";"";"";""')), "simples"), [{kind:"tax",value:{baseCnpj:"12ABC345",simples:true,mei:false}},{kind:"tax",value:{baseCnpj:"00000000",simples:null,mei:null}}]);
  const result = await rows(fixtureZip(iconv.encode('"12ABC345";"Razão";"2062";"49";"9007199254740993,17";"01";""', "win1252")), "empresas");
  assert.deepEqual(result, [{kind:"entity",value:{baseCnpj:"12ABC345",legalName:"Razão",legalNature:"2062",size:"01",capitalCents:"900719925474099317",simples:null,mei:null}}]);
});
test("PROS-04 AC2 decoder rejects an invalid DV as a counted row instead of creating an establishment", async () => {
  const line = ["12ABC345","01DE","34",...Array(27).fill("")].map(v=>`"${v}"`).join(";");
  assert.deepEqual(await rows(fixtureZip(Buffer.from(line)), "estabelecimentos"), [{kind:"rejected",errorCode:"invalid_cnpj"}]);
});
test("PROS-04 AC3 rejects oversized downloads and records and unsupported layouts", async () => {
  await assert.rejects(() => rows(fixtureZip(Buffer.alloc(1000)), "cnaes", {...archiveLimits,importMaximumFileBytes:100}), /archive_download_limit/);
  await assert.rejects(() => rows(fixtureZip(Buffer.from('"01";"' + 'x'.repeat(5000) + '"')), "cnaes"), /archive_record_limit/);
  await assert.rejects(() => rows(fixtureZip(Buffer.from('"01";"a";"extra"')), "cnaes"), /archive_layout_invalid/);
});
test("PROS-05 AC1 rejects downloads whose source validators changed after discovery",async()=>{
  for(const headers of [{etag:'"changed"'},{}]){
    const reader=new CnpjArchiveReader({openResource:async()=>new Response(fixtureZip(Buffer.from('"01";"arroz"')),{headers})},archiveLimits);
    await assert.rejects(()=>reader.prepare({...resource("cnaes"),etag:'"observed"'}).then(async archive=>{await archive.close();return archive;}),/source_changed/);
  }
  const staleDate=new CnpjArchiveReader({openResource:async()=>new Response(fixtureZip(Buffer.from('"01";"arroz"')),{headers:{"last-modified":"Mon, 16 Nov 2026 10:00:23 GMT"}})},archiveLimits);
  await assert.rejects(()=>staleDate.prepare({...resource("cnaes"),lastModified:"Tue, 17 Nov 2026 10:00:23 GMT"}).then(async archive=>{await archive.close();return archive;}),/source_changed/);
  const reader=new CnpjArchiveReader({openResource:async()=>new Response(fixtureZip(Buffer.from('"01";"arroz"')),{headers:{etag:'"observed"'}})},archiveLimits);
  const archive=await reader.prepare({...resource("cnaes"),etag:'"observed"'});try{assert.match(archive.fileHash,/^[a-f0-9]{64}$/);const result=[];for await(const row of archive.rows())result.push(row);assert.deepEqual(result,[{kind:"domain",value:{kind:"cnaes",code:"01",label:"arroz"}}]);}finally{await archive.close();}
});
