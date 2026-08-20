import React, { useRef } from "react";
import { Upload } from "lucide-react";

export interface CsvFileDropzoneProps {
  onFileSelect: (file: File | null) => void;
}

export function CsvFileDropzone({ onFileSelect }: CsvFileDropzoneProps) {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.setAttribute("data-drag-over", "true");
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.removeAttribute("data-drag-over");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.removeAttribute("data-drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  }

  return (
    <>
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: "2px dashed var(--border)",
          borderRadius: 10,
          padding: "40px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: "var(--bg)",
          transition: "all 0.2s",
          opacity: dropZoneRef.current?.getAttribute("data-drag-over") === "true" ? 1 : 0.6,
          borderColor: dropZoneRef.current?.getAttribute("data-drag-over") === "true" ? "var(--accent-dark)" : "var(--border)",
          marginBottom: 16,
        }}
      >
        <Upload size={32} style={{ color: "var(--accent-dark)", marginBottom: 12, margin: "0 auto" }} />
        <p style={{ font: "14px var(--sans)", color: "var(--ink)", margin: "8px 0 4px" }}>
          Clique para selecionar ou arraste um arquivo aqui
        </p>
        <p style={{ font: "12px var(--sans)", color: "var(--faint)", margin: 0 }}>
          Arquivo .csv apenas
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
      />
    </>
  );
}
