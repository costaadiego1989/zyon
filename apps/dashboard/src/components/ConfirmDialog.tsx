import React from "react";
import { Button } from "./Button.js";
import { Modal } from "./Modal.js";
export interface ConfirmDialogProps {
  open: boolean; title: string; description?: string; confirmLabel?: string; cancelLabel?: string;
  variant?: "danger" | "default"; onConfirm: () => void; onCancel: () => void;
  busy?: boolean; error?: string | null;
}
export function ConfirmDialog({ open, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar", variant = "danger", onConfirm, onCancel, busy = false, error }: ConfirmDialogProps) {
  return <Modal isOpen={open} title={title} presentation="center" size="sm" onClose={() => { if (!busy) onCancel(); }}
    footer={<><Button variant="outline" disabled={busy} onClick={onCancel}>{cancelLabel}</Button><Button variant={variant === "danger" ? "danger" : "primary"} disabled={busy} loading={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
    {description && <p className="ui-confirm__description">{description}</p>}
    {error && <p role="alert" className="form-field-error">{error}</p>}
  </Modal>;
}
