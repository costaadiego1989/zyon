import { describe, expect, it } from "vitest";
import { parseAndValidateCsv } from "./csv-validation.js";

describe("CSV import", () => {
  it("preserves blank stock and accepts explicit zero", () => {
    const result = parseAndValidateCsv("name,sku,price,stock\nA,A,10,\nB,B,20,0");
    expect(result.errors).toEqual([]);
    expect(result.rows.map(row => row.stock)).toEqual([undefined, 0]);
  });
  it.each(["-1", "2.5", "2abc", "2147483648"])("rejects invalid stock %s", stock => {
    const result = parseAndValidateCsv(`name,sku,price,stock\nA,A,10,${stock}`);
    expect(result.rows).toEqual([]); expect(result.errors[0]?.field).toBe("stock");
  });
  it("reads commas, escaped quotes, newlines and JSON inside quoted fields", () => {
    const metadata = JSON.stringify({ downloadUrl: "https://example.com/file.pdf", fileFormat: "PDF" });
    const quoted = `"${metadata.replaceAll('"', '""')}"`;
    const result = parseAndValidateCsv(`name,sku,price,description,category,product_type,metadata\r\n"A, B",AB,10,"Linha 1\nLinha ""2""",Downloads,digital,${quoted}`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ name: "A, B", description: 'Linha 1\nLinha "2"', category: "Downloads", product_type: "digital", metadata: JSON.parse(metadata) });
  });
  it.each(["name,sku,price\nA,A,0", 'name,sku,price\n"A,A,10', "name,sku,price\nA,A,10,extra", "name,sku,price,metadata\nA,A,10,[]"])("rejects malformed input", text => {
    expect(parseAndValidateCsv(text).errors.length).toBeGreaterThan(0);
  });
});
