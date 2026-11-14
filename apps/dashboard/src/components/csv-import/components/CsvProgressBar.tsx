import React from "react";
export interface CsvProgressBarProps { isImporting: boolean; rowCount: number; }
export function CsvProgressBar({ isImporting, rowCount }: CsvProgressBarProps) {
  if (!isImporting) return null;
  return <div className="import-dialog__progress" role="status"><progress aria-label="Importação em andamento" /><p>Importando {rowCount} registros. Aguarde a confirmação.</p></div>;
}
