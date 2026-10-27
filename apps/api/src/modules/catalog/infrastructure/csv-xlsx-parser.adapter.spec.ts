import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { CsvXlsxParserAdapter } from "./csv-xlsx-parser.adapter.js";

test("parse CSV with quoted comma preserves field value", async () => {
  const csv = 'name,price\n"Cadeira, Gamer",199.90';
  const buffer = Buffer.from(csv, "utf8");

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(buffer, "text/csv");

  assert.deepEqual(sheet.headers, ["name", "price"]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0]?.name, "Cadeira, Gamer");
  assert.equal(sheet.rows[0]?.price, "199.90");
});

test("parse CSV with trimmed headers and multiple rows", async () => {
  const csv = "  sku  , title , price \nSKU-001,Product A,100.00\nSKU-002,Product B,200.00";
  const buffer = Buffer.from(csv, "utf8");

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(buffer, "text/csv");

  assert.deepEqual(sheet.headers, ["sku", "title", "price"]);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0]?.sku, "SKU-001");
  assert.equal(sheet.rows[0]?.title, "Product A");
  assert.equal(sheet.rows[1]?.sku, "SKU-002");
  assert.equal(sheet.rows[1]?.price, "200.00");
});

test("parse XLSX with headers and rows, coercing numbers to strings", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  ws.addRow(["sku", "title", "price"]);
  ws.addRow(["SKU-001", "Item A", 150.5]);
  ws.addRow(["SKU-002", "Item B", 200]);

  const buffer = await wb.xlsx.writeBuffer();

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(Buffer.from(buffer as ArrayBuffer), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  assert.deepEqual(sheet.headers, ["sku", "title", "price"]);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0]?.sku, "SKU-001");
  assert.equal(sheet.rows[0]?.title, "Item A");
  assert.equal(sheet.rows[0]?.price, "150.5");
  assert.equal(sheet.rows[1]?.price, "200");
});

test("parse XLSX with mimeType 'sheet' shorthand", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");

  ws.addRow(["id", "name"]);
  ws.addRow(["1", "Alice"]);

  const buffer = await wb.xlsx.writeBuffer();

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(Buffer.from(buffer as ArrayBuffer), "application/sheet");

  assert.deepEqual(sheet.headers, ["id", "name"]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0]?.id, "1");
  assert.equal(sheet.rows[0]?.name, "Alice");
});

test("skip fully empty rows in XLSX", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  ws.addRow(["col1", "col2"]);
  ws.addRow(["val1", "val2"]);
  ws.addRow([null, null]); // Empty row
  ws.addRow(["val3", "val4"]);

  const buffer = await wb.xlsx.writeBuffer();

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(Buffer.from(buffer as ArrayBuffer), "application/vnd.ms-excel");

  assert.deepEqual(sheet.headers, ["col1", "col2"]);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0]?.col1, "val1");
  assert.equal(sheet.rows[1]?.col1, "val3");
});

test("throw unsupported_spreadsheet_format for garbage buffer", async () => {
  // Use null bytes which neither CSV nor XLSX can parse meaningfully
  const buffer = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]);

  const adapter = new CsvXlsxParserAdapter();

  try {
    await adapter.parse(buffer, "application/octet-stream");
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(String(err), /unsupported_spreadsheet_format/);
  }
});

test("detect XLSX by ZIP magic bytes PK\\x03\\x04", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Test");

  ws.addRow(["header"]);
  ws.addRow(["data"]);

  const buffer = await wb.xlsx.writeBuffer();
  const uint8 = new Uint8Array(buffer as ArrayBuffer);

  // Verify ZIP magic bytes
  assert.equal(uint8[0], 0x50); // P
  assert.equal(uint8[1], 0x4b); // K
  assert.equal(uint8[2], 0x03);
  assert.equal(uint8[3], 0x04);

  const adapter = new CsvXlsxParserAdapter();
  // Pass misleading mimeType; should detect via magic bytes
  const sheet = await adapter.parse(Buffer.from(buffer as ArrayBuffer), "text/plain");

  assert.deepEqual(sheet.headers, ["header"]);
  assert.equal(sheet.rows.length, 1);
});

test("default to CSV parse attempt when format unclear", async () => {
  const csv = "a,b\n1,2";
  const buffer = Buffer.from(csv, "utf8");

  const adapter = new CsvXlsxParserAdapter();
  const sheet = await adapter.parse(buffer, "application/unknown");

  assert.deepEqual(sheet.headers, ["a", "b"]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0]?.a, "1");
});
