import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
export interface CsvFileDropzoneProps { onFileSelect: (file: File | null) => void; }
export function CsvFileDropzone({ onFileSelect }: CsvFileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <>
    <button type="button" className="import-dialog__dropzone" data-dragging={dragging || undefined} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); onFileSelect(event.dataTransfer.files[0] ?? null); }} onClick={() => input.current?.click()}>
      <Upload size={28} aria-hidden="true" /><strong>Selecionar arquivo CSV</strong><span>Ou arraste o arquivo para esta área.</span>
    </button>
    <input ref={input} type="file" accept=".csv" hidden aria-label="Arquivo CSV" onChange={event => { onFileSelect(event.target.files?.[0] ?? null); event.target.value = ""; }} />
  </>;
}
