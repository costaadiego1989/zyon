import { useEffect, useRef, type RefObject } from "react";

const layers: symbol[] = [];
let previousOverflow = "";
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** One keyboard owner for nested drawers/confirmations; restore focus and scrolling on exit. */
export function useDialogLayer(open: boolean, dialog: RefObject<HTMLElement>, onClose: () => void, initialFocus?: RefObject<HTMLElement>) {
  const close = useRef(onClose);
  close.current = onClose;
  const layer = useRef(Symbol("dialog"));
  useEffect(() => {
    if (!open) return;
    const id = layer.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!layers.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    layers.push(id);
    const timer = window.setTimeout(() => (initialFocus?.current ?? dialog.current)?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== id) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      if (!dialog.current?.contains(document.activeElement) || document.activeElement === dialog.current) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (layers[layers.length - 1] === id && !dialog.current?.contains(event.target as Node)) dialog.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", keepFocus);
      const wasTop = layers[layers.length - 1] === id;
      const index = layers.indexOf(id);
      if (index !== -1) layers.splice(index, 1);
      if (!layers.length) document.body.style.overflow = previousOverflow;
      if (wasTop && trigger?.isConnected) trigger.focus();
    };
  }, [open, dialog, initialFocus]);
}
