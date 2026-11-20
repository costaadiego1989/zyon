// @ts-check
import { parentPort, workerData } from "node:worker_threads";
import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFObjectParser, PDFInvalidObject, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
try {
  const bytes = new Uint8Array(/** @type {ArrayBuffer} */ (workerData)); const text = Buffer.from(bytes).toString("latin1");
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(text)) throw new Error();
  const eof = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-4096));
  const offset = eof ? Number(eof[1]) : NaN;
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= bytes.length || !(text.slice(offset).startsWith("xref") || /^\d+\s+\d+\s+obj\b/.test(text.slice(offset, offset + 80)))) throw new Error();
  /** @type {Set<number>} */ const xrefs = new Set();
  /** @type {(position: number, depth?: number) => import("pdf-lib").PDFRef} */
  const originalRoot = (position, depth = 0) => {
    if (!Number.isSafeInteger(position) || position <= 0 || position >= bytes.length || depth > 32 || xrefs.has(position)) throw new Error(); xrefs.add(position);
    /** @type {import("pdf-lib").PDFDict} */ let dictionary;
    if (text.slice(position).startsWith("xref")) {
      const trailer = text.indexOf("trailer", position + 4); if (trailer < 0) throw new Error();
      let entries = text.slice(position + 4, trailer).trimStart();
      while (entries) {
        const range = /^(\d+)\s+(\d+)\s+/.exec(entries); if (!range) throw new Error(); const first = Number(range[1]), count = Number(range[2]);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count < 1 || first + count > 100000) throw new Error(); entries = entries.slice(range[0].length);
        for (let i = 0; i < count; i++) { const entry = /^(\d{10}) (\d{5}) ([nf])(?:[ \t]*[\r\n]+|[ \t]+)/.exec(entries); if (!entry) throw new Error();
          if (entry[3] === "n") { const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(Number(entry[1]), Number(entry[1]) + 80)); if (!header || Number(header[1]) !== first + i || Number(header[2]) !== Number(entry[2])) throw new Error(); } entries = entries.slice(entry[0].length); }
        entries = entries.trimStart();
      }
      const parsed = PDFObjectParser.forBytes(bytes.subarray(trailer + 7), PDFContext.create()).parseObject(); if (!(parsed instanceof PDFDict)) throw new Error(); dictionary = parsed;
    } else {
      const header = /^\d+\s+\d+\s+obj\s*/.exec(text.slice(position, position + 80)); if (!header) throw new Error();
      const parsed = PDFObjectParser.forBytes(bytes.subarray(position + header[0].length), PDFContext.create()).parseObject();
      if (!(parsed instanceof PDFRawStream) || parsed.dict.lookup(PDFName.of("Type"), PDFName).asString() !== "/XRef") throw new Error(); dictionary = parsed.dict;
    }
    const size = dictionary.lookup(PDFName.of("Size"), PDFNumber).asNumber(); if (!Number.isSafeInteger(size) || size < 1 || size > 100000) throw new Error();
    const root = dictionary.get(PDFName.of("Root")); const previous = dictionary.get(PDFName.of("Prev"));
    const inherited = previous instanceof PDFNumber ? originalRoot(previous.asNumber(), depth + 1) : undefined;
    if (root instanceof PDFRef) return root; if (!inherited) throw new Error(); return inherited;
  };
  const rootReference = originalRoot(offset);
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
  if (document.isEncrypted || !(document.context.trailerInfo.Root instanceof PDFRef) || document.context.trailerInfo.Root.toString() !== rootReference.toString()) throw new Error();
  const catalog = document.context.lookup(document.context.trailerInfo.Root, PDFDict);
  if (catalog.lookup(PDFName.of("Type"), PDFName).asString() !== "/Catalog") throw new Error();
  /** @type {Set<string>} */ const seen = new Set(); let nodes = 0;
  /** @type {(reference: import("pdf-lib").PDFRef, parent?: import("pdf-lib").PDFRef, depth?: number) => number} */
  const countPages = (reference, parent, depth = 0) => {
    if (seen.has(reference.toString()) || ++nodes > 10000 || depth > 64) throw new Error(); seen.add(reference.toString());
    const node = document.context.lookup(reference, PDFDict); const type = node.lookup(PDFName.of("Type"), PDFName).asString();
    if (parent && node.get(PDFName.of("Parent"))?.toString() !== parent.toString()) throw new Error();
    if (type === "/Page") return 1;
    if (type !== "/Pages") throw new Error(); const kids = node.lookup(PDFName.of("Kids"), PDFArray); let count = 0;
    if (!kids.size() || kids.size() > 10000) throw new Error();
    for (let i = 0; i < kids.size(); i++) { const child = kids.get(i); if (!(child instanceof PDFRef)) throw new Error(); count += countPages(child, reference, depth + 1); }
    if (count !== node.lookup(PDFName.of("Count"), PDFNumber).asNumber()) throw new Error(); return count;
  };
  const rootPages = catalog.get(PDFName.of("Pages")); if (!(rootPages instanceof PDFRef)) throw new Error(); const count = countPages(rootPages);
  const pages = document.getPages(); if (!count || count !== pages.length) throw new Error();
  for (const page of pages) if (!Number.isFinite(page.getWidth()) || !Number.isFinite(page.getHeight()) || page.getWidth() <= 0 || page.getHeight() <= 0) throw new Error();
  const objects = document.context.enumerateIndirectObjects(); if (objects.length > 100000) throw new Error();
  /** @type {Set<string>} */ const references = new Set();
  /** @type {(object: unknown, depth?: number) => void} */
  const walk = (object, depth = 0) => {
    if (depth > 100) throw new Error();
    if (object instanceof PDFRef) { const key = object.toString(); if (references.has(key)) return; references.add(key); const resolved = document.context.lookup(object); if (!resolved) throw new Error(); walk(resolved, depth + 1); }
    else if (object instanceof PDFArray) { for (let i = 0; i < object.size(); i++) walk(object.get(i), depth + 1); }
    else if (object instanceof PDFDict) { for (const [, value] of object.entries()) walk(value, depth + 1); }
    else if (object instanceof PDFRawStream) { const length = object.dict.lookup(PDFName.of("Length"), PDFNumber).asNumber(); if (length !== object.getContents().length) throw new Error();
      const filter = object.dict.get(PDFName.of("Filter")); const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
      const names = filters.map(item => { if (!(item instanceof PDFName)) throw new Error(); return item.asString(); });
      const supported = ["/FlateDecode", "/LZWDecode", "/ASCII85Decode", "/ASCIIHexDecode", "/RunLengthDecode"];
      if (names.every(name => supported.includes(name)) && decodePDFRawStream(object).decode().length > 20 * 1024 * 1024) throw new Error();
      walk(object.dict, depth + 1); }
    else if (object instanceof PDFInvalidObject) throw new Error();
  };
  for (const [, object] of objects) walk(object);
  (/** @type {import("node:worker_threads").MessagePort} */ (parentPort)).postMessage(true);
} catch { (/** @type {import("node:worker_threads").MessagePort} */ (parentPort)).postMessage(false); }
