import { useEffect, useRef, type RefObject } from "react";

type Modal = { scope: HTMLElement; dialog: HTMLElement; focus: () => void };
const stacks = new WeakMap<Document, Modal[]>();
const inertOwners = new WeakMap<HTMLElement, { count: number; original: boolean }>();
const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((node) =>
    !node.closest('[inert], [hidden], [aria-hidden="true"]') && node.getClientRects().length > 0 && node.tabIndex >= 0);
}

/** Keeps keyboard focus in the topmost dialog and restores the invoking control. */
export function activateModalFocus(scope: HTMLElement, dialog: HTMLElement, onClose: () => void, returnFocus?: () => HTMLElement | null): () => void {
  const doc = dialog.ownerDocument;
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const stack = stacks.get(doc) ?? [];
  stacks.set(doc, stack);
  const modal: Modal = { scope, dialog, focus: () => (focusable(dialog)[0] ?? dialog).focus({ preventScroll: true }) };
  const background: HTMLElement[] = [];
  let branch: HTMLElement = scope;
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
      const ownership = inertOwners.get(sibling) ?? { count: 0, original: sibling.inert };
      ownership.count++;
      inertOwners.set(sibling, ownership);
      sibling.inert = true;
      background.push(sibling);
    }
    if (branch.parentElement === doc.body) break;
    branch = branch.parentElement;
  }
  stack.push(modal);
  const top = () => stack[stack.length - 1] === modal;
  const keydown = (event: KeyboardEvent) => {
    if (!top()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    } else if (event.key === "Tab") {
      const controls = focusable(dialog);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (!dialog.contains(doc.activeElement) || doc.activeElement === dialog || (event.shiftKey ? doc.activeElement === first : doc.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  };
  const focusin = (event: FocusEvent) => { if (top() && !dialog.contains(event.target as Node)) modal.focus(); };
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("focusin", focusin);
  modal.focus();
  return () => {
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("focusin", focusin);
    const wasTop = top();
    const index = stack.indexOf(modal);
    if (index >= 0) stack.splice(index, 1);
    for (const node of background) {
      const ownership = inertOwners.get(node);
      if (!ownership || --ownership.count > 0) continue;
      node.inert = ownership.original;
      inertOwners.delete(node);
    }
    if (!wasTop) return;
    const parent = stack[stack.length - 1];
    // Resolve after the closing React commit, when a conditional opener exists again.
    const target = returnFocus?.() ?? previous;
    if (target?.isConnected && !target.closest("[inert]") && (!parent || parent.dialog.contains(target))) target.focus({ preventScroll: true });
    else parent?.focus();
  };
}

export function useModalFocus(open: boolean, dialogRef: RefObject<HTMLElement | null>, onClose: () => void, scopeRef = dialogRef, returnFocus?: () => HTMLElement | null): void {
  const closeRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocus);
  closeRef.current = onClose;
  returnFocusRef.current = returnFocus;
  useEffect(() => {
    if (!open || !dialogRef.current || !scopeRef.current) return;
    return activateModalFocus(scopeRef.current, dialogRef.current, () => closeRef.current(), () => returnFocusRef.current?.() ?? null);
  }, [open, dialogRef, scopeRef]);
}
