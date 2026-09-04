import { useState, useCallback } from "react";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { CsvRow } from "../utils/csv-validation.js";

export interface UseCsvUploaderReturn {
  importing: boolean;
  importError: string | null;
  handleImport: (rows: CsvRow[], onImport: (rows: CsvRow[]) => Promise<void>) => Promise<boolean>;
  resetError: () => void;
}

export function useCsvUploader(): UseCsvUploaderReturn {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const resetError = useCallback(() => setImportError(null), []);

  const handleImport = useCallback(
    async (rows: CsvRow[], onImport: (rows: CsvRow[]) => Promise<void>): Promise<boolean> => {
      if (rows.length === 0) return false;

      setImporting(true);
      setImportError(null);

      try {
        await onImport(rows);
        return true;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setImportError(message);
        reportError({ source: "CsvImportModal.handleImport", error: e });
        return false;
      } finally {
        setImporting(false);
      }
    },
    [],
  );

  return { importing, importError, handleImport, resetError };
}
