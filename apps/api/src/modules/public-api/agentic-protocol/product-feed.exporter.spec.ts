import test from "node:test";
import assert from "node:assert/strict";
import { ProductFeedCsvExporter, ProductFeedJsonExporter } from "./product-feed.exporter.js";
import type { MerchantFeedRow } from "./product-feed.mapper.js";

const mockRow = (): MerchantFeedRow => ({
  id: "prod_1",
  title: "Product 1",
  description: "Description",
  link: "https://example.com/prod1",
  image_link: "https://example.com/img1.jpg",
  availability: "in_stock",
  price: "99.99 BRL",
  brand: "Brand",
  currency: "BRL",
});

test("escapeField leaves simple text unchanged", () => {
  assert.equal(ProductFeedCsvExporter.escapeField("hello"), "hello");
  assert.equal(ProductFeedCsvExporter.escapeField(""), "");
});

test("escapeField quotes field with comma", () => {
  assert.equal(
    ProductFeedCsvExporter.escapeField("hello, world"),
    '"hello, world"',
  );
});

test("escapeField quotes field with newline", () => {
  assert.equal(
    ProductFeedCsvExporter.escapeField("hello\nworld"),
    '"hello\nworld"',
  );
});

test("escapeField quotes field with double-quote and escapes it", () => {
  assert.equal(
    ProductFeedCsvExporter.escapeField('hello "world"'),
    '"hello ""world"""',
  );
});

test("escapeField quotes field with carriage return", () => {
  assert.equal(
    ProductFeedCsvExporter.escapeField("hello\rworld"),
    '"hello\rworld"',
  );
});

test("rowToCsv converts row to CSV line", () => {
  const row = mockRow();
  const csv = ProductFeedCsvExporter.rowToCsv(row);

  assert.ok(csv.endsWith("\n"), "should end with newline");
  const fields = csv.trim().split(",");
  assert.equal(fields.length, 9, "should have 9 fields");
  assert.equal(fields[0], "prod_1");
  assert.equal(fields[1], "Product 1");
});

test("rowToCsv escapes fields with special characters", () => {
  const row: MerchantFeedRow = {
    ...mockRow(),
    description: 'Product "Special", features',
  };
  const csv = ProductFeedCsvExporter.rowToCsv(row);
  assert.ok(
    csv.includes('"Product ""Special"", features"'),
    "should escape quotes and handle comma",
  );
});

test("csv toStream emits header then rows", async () => {
  const rows = [mockRow(), mockRow()];
  const stream = ProductFeedCsvExporter.toStream(rows);

  let output = "";
  for await (const chunk of stream) {
    output += chunk.toString();
  }

  const lines = output.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 3, "should have 1 header + 2 rows");
  assert.ok(
    lines[0].includes("id,title,description"),
    "first line should be header",
  );
});

test("csv toStream handles empty rows", async () => {
  const stream = ProductFeedCsvExporter.toStream([]);
  let output = "";
  for await (const chunk of stream) {
    output += chunk.toString();
  }

  const lines = output.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, "should have header only");
});

test("json toStream emits newline-delimited JSON", async () => {
  const rows = [mockRow(), mockRow()];
  const stream = ProductFeedJsonExporter.toStream(rows);

  let output = "";
  for await (const chunk of stream) {
    output += chunk.toString();
  }

  const lines = output.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2, "should have 2 JSON objects");

  const obj1 = JSON.parse(lines[0]);
  assert.equal(obj1.id, "prod_1");
  assert.equal(obj1.title, "Product 1");

  const obj2 = JSON.parse(lines[1]);
  assert.equal(obj2.id, "prod_1");
});

test("json toStream handles empty rows", async () => {
  const stream = ProductFeedJsonExporter.toStream([]);
  let output = "";
  for await (const chunk of stream) {
    output += chunk.toString();
  }

  assert.equal(output.trim(), "", "should emit nothing for empty rows");
});
