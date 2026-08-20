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
  const parsed = parseAs === "int" ? parseInt(value, 10) : parseFloat(value);
  if (isNaN(parsed) || parsed < 0) {
    return { rowIndex, field, message };
  }
  return null;
}

export function parseAndValidateCsv(text: string): ParseResult {
  const lines = text.split("\n").filter((l) => l.trim());
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

  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
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
    const cols = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

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

    if (!name) {
      validationErrors.push({ rowIndex, field: "name", message: "Nome é obrigatório" });
    }
    if (!sku) {
      validationErrors.push({ rowIndex, field: "sku", message: "SKU é obrigatório" });
    }
    if (!priceStr) {
      validationErrors.push({ rowIndex, field: "price", message: "Preço é obrigatório" });
    } else {
      const err = validateNumericField(priceStr, "price", rowIndex, "Preço deve ser um número válido >= 0");
      if (err) validationErrors.push(err);
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
