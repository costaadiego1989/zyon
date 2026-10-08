import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogLayer } from "./useDialogLayer.js";
import "./dashboard-ui.css";

export interface ModalProps {
  isOpen: boolean; title: string; subtitle?: string; eyebrow?: string;
  presentation?: "drawer" | "floating-panel" | "center";
  size?: "sm" | "md" | "lg" | "xl";
  onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}
export function Modal({ isOpen, title, subtitle, eyebrow, presentation = "drawer", size = "md", onClose, children, footer }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogLayer(isOpen, dialog, onClose, closeButton);
  if (!isOpen) return null;
  return createPortal(
    <div className={"dashboard-ui ui-dialog-backdrop ui-dialog-backdrop--" + presentation} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? descriptionId : undefined} tabIndex={-1} className={"ui-dialog ui-dialog--" + presentation + " ui-dialog--" + size}>
        <header className="ui-dialog__header">
          <div className="ui-dialog__heading">
            {eyebrow && <span className="ui-dialog__eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={descriptionId}>{subtitle}</p>}
          </div>
          <button type="button" className="ui-icon-button" ref={closeButton} onClick={onClose} aria-label="Fechar"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer && <footer className="ui-dialog__footer">{footer}</footer>}
      </div>
    </div>, document.body,
  );
}
