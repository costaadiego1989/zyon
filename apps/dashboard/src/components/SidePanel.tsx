import React from "react";
import { Edit } from "lucide-react";
import { Modal } from "./Modal.js";
export interface SidePanelProps { isOpen: boolean; title: string; onClose: () => void; children: React.ReactNode; subtitle?: string; footer?: React.ReactNode; }
export function SidePanel(props: SidePanelProps) { return <Modal {...props} />; }
export interface EditButtonProps { onClick: () => void; size?: number; }
export function EditButton({ onClick, size = 16 }: EditButtonProps) {
  return <button type="button" className="ui-icon-button" onClick={onClick} aria-label="Editar" title="Editar"><Edit size={size} aria-hidden="true" /></button>;
}
