import { useState, useCallback } from "react";
import { useCsvParser } from "./useCsvParser.js";
import { useCsvUploader } from "./useCsvUploader.js";
import type { CsvRow } from "../utils/csv-validation.js";

export type ModalStep = "upload" | "preview" | "confirm";

export interface UseCsvImportReturn {
  step: ModalStep;
  parsedRows: CsvRow[];
  errors: ReturnType<typeof useCsvParser>["errors"];
  importing: boolean;
  importError: string | null;
  fileInputRef: ReturnType<typeof useCsvParser>["fileInputRef"];
  handleFileSelect: (file: File | null) => void;
  goToPreview: () => void;
  goToConfirm: () => void;
  goBack: () => void;
  handleImportConfirm: (onImport: (rows: CsvRow[]) => Promise<void>, onClose: () => void) => Promise<void>;
  resetAll: () => void;
}

export function useCsvImport(): UseCsvImportReturn {
  const [step, setStep] = useState<ModalStep>("upload");

  const parser = useCsvParser(() => setStep("preview"));
  const uploader = useCsvUploader();

  const goToPreview = useCallback(() => setStep("preview"), []);
  const goToConfirm = useCallback(() => setStep("confirm"), []);

  const goBack = useCallback(() => {
    if (step === "confirm") {
      setStep("preview");
    } else if (step === "preview") {
      setStep("upload");
      parser.reset();
    }
  }, [step, parser]);

  const handleImportConfirm = useCallback(
    async (onImport: (rows: CsvRow[]) => Promise<void>, onClose: () => void) => {
      const success = await uploader.handleImport(parser.parsedRows, onImport);
      if (success) {
        setStep("upload");
        parser.reset();
        onClose();
      }
    },
    [parser, uploader],
  );

  const resetAll = useCallback(() => {
    setStep("upload");
    parser.reset();
    uploader.resetError();
  }, [parser, uploader]);

  return {
    step,
    parsedRows: parser.parsedRows,
    errors: parser.errors,
    importing: uploader.importing,
    importError: uploader.importError,
    fileInputRef: parser.fileInputRef,
    handleFileSelect: parser.handleFileSelect,
    goToPreview,
    goToConfirm,
    goBack,
    handleImportConfirm,
    resetAll,
  };
}
