import { Injectable } from "@nestjs/common";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { SpreadsheetParserPort, RawSheet } from "../domain/ports/spreadsheet-parser.port.js";

/**
 * CSV/XLSX parser adapter implementing SpreadsheetParserPort.
 * Handles CSV (via papaparse) and XLSX (via exceljs).
 * Format detection: mimeType + content sniffing (ZIP magic bytes for XLSX).
 */
@Injectable()
export class CsvXlsxParserAdapter implements SpreadsheetParserPort {
  async parse(buffer: Buffer, mimeType: string): Promise<RawSheet> {
    // Detect format by mimeType and/or content sniff
    const isXlsxByMimeType =
      mimeType.includes("sheet") ||
      mimeType.includes("excel") ||
      mimeType.includes("xlsx");

    const isXlsxByMagic = this.isXlsxMagicBytes(buffer);

    if (isXlsxByMimeType || isXlsxByMagic) {
      return this.parseXlsx(buffer);
    }

    // Try CSV parse — requires mime to be csv/text/plain OR content looks like CSV
    const looksLikeCsv =
      mimeType.includes("csv") ||
      mimeType.includes("text/plain") ||
      mimeType.includes("text/csv") ||
      this.looksLikeCsvContent(buffer);

    if (looksLikeCsv) {
      const csvResult = this.parseCsv(buffer);
      if (csvResult.headers.length > 0) {
        return csvResult;
      }
    }

    // Last resort: try XLSX
    try {
      const xlsxResult = await this.parseXlsx(buffer);
      if (xlsxResult.headers.length > 0) {
        return xlsxResult;
      }
    } catch {
      // ignore
    }

    throw new Error("unsupported_spreadsheet_format");
  }

  private looksLikeCsvContent(buffer: Buffer): boolean {
    // Heuristic: contains commas or newlines, and is mostly printable ASCII
    const text = buffer.toString("utf8");
    if (!text.includes(",") && !text.includes("\n") && !text.includes("\r")) {
      return false;
    }
    // Check for too many non-printable chars (binary garbage)
    let nonPrintable = 0;
    for (let i = 0; i < Math.min(text.length, 256); i++) {
      const code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintable++;
      }
      if (code === 0xfffd) {
        // replacement char from invalid UTF-8
        nonPrintable += 2;
      }
    }
    return nonPrintable < 4;
  }

  private isXlsxMagicBytes(buffer: Buffer): boolean {
    // ZIP magic bytes: PK\x03\x04 (0x50 0x4B 0x03 0x04)
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    );
  }

  private parseCsv(buffer: Buffer): RawSheet {
    const text = buffer.toString("utf8");

    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });

    const headers = (result.meta.fields || []).map((h) => (h || "").trim());
    const rows = (result.data as Array<Record<string, unknown>>)
      .filter((row) => Object.keys(row).some((k) => row[k] !== undefined && row[k] !== ""))
      .map((row) => {
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          const trimmedKey = (key || "").trim();
          normalized[trimmedKey] = String(value || "").trim();
        }
        return normalized;
      });

    return { headers, rows };
  }

  private async parseXlsx(buffer: Buffer): Promise<RawSheet> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    const ws = wb.worksheets[0];
    if (!ws) {
      throw new Error("unsupported_spreadsheet_format");
    }

    const headers: string[] = [];
    const rows: Array<Record<string, string>> = [];

    let isHeaderRow = true;
    ws.eachRow((row, rowNumber) => {
      const values: string[] = [];
      let isEmptyRow = true;

      row.eachCell((cell) => {
        const cellValue = cell.value;
        let stringValue = "";

        if (cellValue !== null && cellValue !== undefined && cellValue !== "") {
          if (typeof cellValue === "number") {
            stringValue = String(cellValue);
          } else if (cellValue instanceof Date) {
            stringValue = cellValue.toISOString();
          } else {
            stringValue = String(cellValue);
          }
          isEmptyRow = false;
        }

        values.push(stringValue.trim());
      });

      // Skip fully empty rows
      if (isEmptyRow) {
        return;
      }

      if (isHeaderRow) {
        headers.push(...values);
        isHeaderRow = false;
      } else {
        const rowObj: Record<string, string> = {};
        headers.forEach((header, idx) => {
          rowObj[header] = values[idx] || "";
        });
        rows.push(rowObj);
      }
    });

    return { headers, rows };
  }
}
