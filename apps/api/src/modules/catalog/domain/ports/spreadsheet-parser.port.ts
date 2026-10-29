export const SPREADSHEET_PARSER = Symbol("SpreadsheetParserPort");

export interface RawSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface SpreadsheetParserPort {
  parse(buffer: Buffer, mimeType: string): Promise<RawSheet>;
}
