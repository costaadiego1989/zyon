import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect } from "vitest";
export function ui() {
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container); const root: Root = createRoot(container);
  return {container,
    render: async (node: ReactNode) => {await act(async () => {root.render(node);});},
    click: async (label: string) => {const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label || b.getAttribute("aria-label") === label); expect(button, label).toBeDefined(); await act(async () => {button!.click();});},
    change: async (label: string, value: string) => {const el = Array.from(container.querySelectorAll("input,select,textarea")).find(e => e.getAttribute("aria-label") === label || container.querySelector(`label[for="${e.id}"]`)?.textContent === label) as HTMLInputElement; expect(el, label).toBeDefined(); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => {Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", {bubbles: true}));});},
    close: async () => {await act(async () => root.unmount()); container.remove();}
  };
}
