import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import "./toast.css";
export interface ToastMessage { id: string; type: "success" | "error"; text: string }
const listeners = new Set<(message: ToastMessage) => void>();
export function showToast(type: ToastMessage["type"], text: string) {
  const message = { id: `${Date.now()}-${Math.random()}`, type, text };
  listeners.forEach(listener => listener(message));
}
function ToastRow({ message, dismiss }: { message: ToastMessage; dismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => dismiss(message.id), message.type === "error" ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [message.id, message.type, dismiss, hovered, focused]);
  return <div className={"ui-toast ui-toast--" + message.type} role={message.type === "error" ? "alert" : "status"}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {message.type === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
    <span>{message.text}</span>
    <button type="button" onClick={() => dismiss(message.id)} aria-label="Fechar aviso"><X size={16} /></button>
  </div>;
}
export function ToastContainer() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: string) => setMessages(previous => previous.filter(message => message.id !== id)), []);
  useEffect(() => {
    const listener = (message: ToastMessage) => setMessages(previous => [...previous, message].slice(-5));
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return <div className="ui-toast-stack" aria-label="Avisos">{messages.map(message => <ToastRow key={message.id} message={message} dismiss={dismiss} />)}</div>;
}
