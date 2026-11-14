export interface CsvRow {
  name: string;
  sku: string;
  price: number;
  stock?: number;
  weight_grams?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  description?: string;
  category?: string;
  product_type?: "physical" | "digital" | "service" | "food";
  metadata?: Record<string, unknown>;
}

export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface ParseResult {
  rows: CsvRow[];
  errors: ValidationError[];
}

const REQUIRED_HEADERS = ["name", "sku", "price"] as const;

function validateNumericField(
  value: string | undefined,
  field: string,
  rowIndex: number,
  message: string,
  parseAs: "int" | "float" = "float",
): ValidationError | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (parseAs === "int" && (!/^\+?\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed > 2_147_483_647))) {
    return { rowIndex, field, message };
  }
  return null;
}

/** Quoted commas, escaped quotes and line breaks are part of a CSV cell. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { record.push(cell.trim()); cell = ""; closed = false; };
  const pushRecord = () => { pushCell(); if (record.some(Boolean)) records.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; pushRecord(); }
    else if (char === '"') {
      if (cell.trim() || closed) throw new Error("Aspas inválidas no CSV");
      cell = ""; quoted = true;
    } else {
      if (closed && char.trim()) throw new Error("Conteúdo após o fechamento de aspas no CSV");
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new Error("Campo com aspas não fechadas no CSV");
  pushRecord();
  return records;
}

export function parseAndValidateCsv(text: string): ParseResult {
  let lines: string[][];
  try { lines = csvRecords(text.replace(/^\uFEFF/, "")); }
  catch (error) { return { rows: [], errors: [{ rowIndex: 0, field: "file", message: (error as Error).message }] }; }
  const csvRows: CsvRow[] = [];
  const validationErrors: ValidationError[] = [];

  if (lines.length < 2) {
    validationErrors.push({
      rowIndex: 0,
      field: "file",
      message: "CSV vazio ou sem dados. Mínimo de 1 linha de dados requerida.",
    });
    return { rows: [], errors: validationErrors };
  }

  const header = lines[0]!.map((h) => h.trim().toLowerCase());
  if (new Set(header).size !== header.length) return { rows: [], errors: [{ rowIndex: 0, field: "header", message: "Colunas duplicadas no CSV" }] };
  const idx = {
    name: header.indexOf("name"),
    sku: header.indexOf("sku"),
    price: header.indexOf("price"),
    stock: header.indexOf("stock"),
    weight_grams: header.indexOf("weight_grams"),
    length_cm: header.indexOf("length_cm"),
    width_cm: header.indexOf("width_cm"),
    height_cm: header.indexOf("height_cm"),
    description: header.indexOf("description"),
    category: header.indexOf("category"),
    product_type: header.indexOf("product_type"),
    metadata: header.indexOf("metadata"),
  };

  if (idx.name === -1 || idx.sku === -1 || idx.price === -1) {
    validationErrors.push({
      rowIndex: 0,
      field: "header",
      message: `CSV deve conter as colunas obrigatórias: ${REQUIRED_HEADERS.join(", ")}`,
    });
    return { rows: [], errors: validationErrors };
  }

  for (let i = 1; i < lines.length; i++) {
    const rowIndex = i - 1;
    const cols = lines[i]!;
    if (cols.length !== header.length) {
      validationErrors.push({ rowIndex, field: "row", message: "Quantidade de campos diferente do cabeçalho" });
      continue;
    }

    const name = cols[idx.name]?.trim();
    const sku = cols[idx.sku]?.trim();
    const priceStr = cols[idx.price]?.trim();
    const stockStr = cols[idx.stock]?.trim();
    const weightStr = cols[idx.weight_grams]?.trim();
    const lengthStr = cols[idx.length_cm]?.trim();
    const widthStr = cols[idx.width_cm]?.trim();
    const heightStr = cols[idx.height_cm]?.trim();
    const description = cols[idx.description]?.trim();
    const category = cols[idx.category]?.trim();
    const typeStr = cols[idx.product_type]?.trim().toLowerCase();
    const typeAliases: Record<string, CsvRow["product_type"]> = { physical: "physical", fisico: "physical", "físico": "physical", digital: "digital", service: "service", servico: "service", "serviço": "service", food: "food", alimento: "food", comida: "food" };
    const productType = typeStr ? typeAliases[typeStr] : undefined;
    if (typeStr && !productType) validationErrors.push({ rowIndex, field: "product_type", message: "Tipo de produto inválido" });
    let metadata: Record<string, unknown> | undefined;
    const metadataStr = cols[idx.metadata];
    if (metadataStr) {
      try {
        const parsed: unknown = JSON.parse(metadataStr);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        metadata = parsed as Record<string, unknown>;
      } catch { validationErrors.push({ rowIndex, field: "metadata", message: "Metadados devem ser um objeto JSON válido" }); }
    }

    if (!name) {
      validationErrors.push({ rowIndex, field: "name", message: "Nome é obrigatório" });
    }
    if (!sku) {
      validationErrors.push({ rowIndex, field: "sku", message: "SKU é obrigatório" });
    }
    if (!priceStr) {
      validationErrors.push({ rowIndex, field: "price", message: "Preço é obrigatório" });
    } else {
      const err = validateNumericField(priceStr, "price", rowIndex, "Preço deve ser um número válido maior que zero");
      if (err) validationErrors.push(err);
      else if (Number(priceStr) <= 0 || Math.round(Number(priceStr) * 100) > 2_147_483_647) validationErrors.push({ rowIndex, field: "price", message: "Preço fora do intervalo permitido" });
    }

    const numericChecks: Array<[string | undefined, string, string, "int" | "float"]> = [
      [stockStr, "stock", "Estoque deve ser um número inteiro >= 0", "int"],
      [weightStr, "weight_grams", "Peso deve ser um número válido >= 0", "float"],
      [lengthStr, "length_cm", "Comprimento deve ser um número válido >= 0", "float"],
      [widthStr, "width_cm", "Largura deve ser um número válido >= 0", "float"],
      [heightStr, "height_cm", "Altura deve ser um número válido >= 0", "float"],
    ];

    for (const [val, field, msg, parseAs] of numericChecks) {
      const err = validateNumericField(val, field, rowIndex, msg, parseAs);
      if (err) validationErrors.push(err);
    }

    const rowHasErrors = validationErrors.some((e) => e.rowIndex === rowIndex);
    if (!rowHasErrors && name && sku && priceStr) {
      csvRows.push({
        name,
        sku,
        price: parseFloat(priceStr),
        stock: stockStr ? parseInt(stockStr, 10) : undefined,
        weight_grams: weightStr ? parseFloat(weightStr) : undefined,
        length_cm: lengthStr ? parseFloat(lengthStr) : undefined,
        width_cm: widthStr ? parseFloat(widthStr) : undefined,
        height_cm: heightStr ? parseFloat(heightStr) : undefined,
        description: description || undefined,
        category: category || undefined,
        product_type: productType,
        metadata,
      });
    }
  }

  return { rows: csvRows, errors: validationErrors };
}

export function groupErrorsByRow(errors: ValidationError[]): Map<number, ValidationError[]> {
  const map = new Map<number, ValidationError[]>();
  errors.forEach((err) => {
    if (!map.has(err.rowIndex)) {
      map.set(err.rowIndex, []);
    }
    map.get(err.rowIndex)!.push(err);
  });
  return map;
}
