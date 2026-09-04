import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

export interface ToastMessage {
  id: string;
  type: "success" | "error";
  text: string;
}

let toastListeners: Array<(msg: ToastMessage) => void> = [];

export function showToast(type: "success" | "error", text: string) {
  const msg: ToastMessage = { id: `${Date.now()}-${Math.random()}`, type, text };
  toastListeners.forEach((fn) => fn(msg));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setToasts((prev) => [...prev, msg]);
    };
    toastListeners.push(handler);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== handler);
    };
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    const timer = setTimeout(() => dismiss(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      pointerEvents: "none",
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === "error" ? "alert" : "status"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderRadius: 10,
            background: toast.type === "success" ? "var(--color-success-bg)" : "var(--color-error-bg)",
            border: `1px solid ${toast.type === "success" ? "var(--color-success)" : "var(--color-error)"}`,
            color: toast.type === "success" ? "var(--color-success)" : "var(--color-error)",
            font: "500 13px var(--font-sans)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
            animation: "toastSlideIn 0.2s ease-out",
          }}
        >
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
