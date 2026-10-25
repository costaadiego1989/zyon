import { useState, useCallback, useRef } from "react";
import { parseAndValidateCsv, type CsvRow, type ValidationError } from "../utils/csv-validation.js";

export interface UseCsvParserReturn {
  parsedRows: CsvRow[];
  errors: ValidationError[];
  handleFileSelect: (file: File | null) => void;
  reset: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useCsvParser(onParsed: (rows: CsvRow[]) => void): UseCsvParserReturn {
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setParsedRows([]);
    setErrors([]);
  }, []);

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".csv")) {
        setErrors([{ rowIndex: 0, field: "file", message: "Apenas arquivos .csv são suportados" }]);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const { rows, errors: validationErrors } = parseAndValidateCsv(text);
        setErrors(validationErrors);
        setParsedRows(rows);

        if (validationErrors.length === 0 && rows.length > 0) {
          onParsed(rows);
        }
      };
      reader.onerror = () => {
        setErrors([{ rowIndex: 0, field: "file", message: "Erro ao ler arquivo" }]);
      };
      reader.readAsText(file);
    },
    [onParsed],
  );

  return { parsedRows, errors, handleFileSelect, reset, fileInputRef };
}
