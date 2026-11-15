/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceNamesField, type ServiceNamesFieldProps } from "./ServiceNamesField.js";

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const entry of mounted.splice(0)) { await act(async () => entry.root.unmount()); entry.host.remove(); }
});

async function render(initial: string[] = [], initialMode: ServiceNamesFieldProps["businessMode"] = "services", disabled = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  mounted.push({ root, host });
  const state = { names: initial, changes: [] as string[][] };
  let mode = initialMode, locked = disabled;
  function Form({ businessMode, disabled: readOnly }: Pick<ServiceNamesFieldProps, "businessMode" | "disabled">) {
    const [value, setValue] = useState(initial);
    return <ServiceNamesField businessMode={businessMode} disabled={readOnly} value={value}
      onChange={next => { state.names = next; state.changes.push([...next]); setValue(next); }} />;
  }
  async function update(next: { businessMode?: ServiceNamesFieldProps["businessMode"]; disabled?: boolean }) {
    mode = next.businessMode ?? mode; locked = next.disabled ?? locked;
    await act(async () => root.render(<Form businessMode={mode} disabled={locked} />));
  }
  await update({});
  return { host, state, update };
}
function input(host: HTMLElement, label: string) {
  const element = Array.from(host.querySelectorAll("label")).find(node => node.textContent === label);
  expect(element, "label " + label).toBeTruthy();
  const control = document.getElementById(element!.htmlFor);
  expect(control?.tagName).toBe("INPUT"); return control as HTMLInputElement;
}
function button(host: HTMLElement, text: string) {
  const target = Array.from(host.querySelectorAll("button")).find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text);
  expect(target, "button " + text).toBeTruthy(); return target!;
}
async function type(target: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { target.focus(); setValue.call(target, text); target.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function enter(target: HTMLInputElement) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); }); return event;
}
async function click(target: HTMLButtonElement) { await act(async () => target.click()); }

describe("T97 service names field", () => {
  it("does not expose controls or call onChange for a product company with historical names", async () => {
    const form = await render(["Historical service"], "products");
    expect(form.host.querySelector("fieldset")).toBeNull(); expect(form.host.querySelector("input")).toBeNull();
    expect(form.host.textContent).toBe(""); expect(form.state.changes).toEqual([]);
    expect(form.state.names).toEqual(["Historical service"]);
  });

  it("keeps hooks valid and saved names intact across services/products/services rerenders", async () => {
    const form = await render(["Consulta"]);
    await type(input(form.host, "Novo serviço"), "Unsaved draft");
    await form.update({ businessMode: "products" }); expect(form.host.querySelector("input")).toBeNull();
    await form.update({ businessMode: "services" });
    expect(input(form.host, "Serviço 1").value).toBe("Consulta"); expect(input(form.host, "Novo serviço").value).toBe("");
    expect(form.state.changes).toEqual([]);
  });

  it("adds trimmed names with Enter or the plus button and keeps focus ready for the next name", async () => {
    const form = await render(), draft = input(form.host, "Novo serviço");
    const help = document.getElementById(draft.getAttribute("aria-describedby")!.split(" ")[0])!;
    expect(help.textContent).toContain("ajudam o assistente"); expect(help.textContent).toContain("informações públicas");
    expect(form.host.textContent?.toLowerCase()).not.toContain("rag");
    await type(draft, "  Consulta de neurologia  "); const event = await enter(draft);
    expect(event.defaultPrevented).toBe(true); expect(form.state.names).toEqual(["Consulta de neurologia"]);
    expect(draft.value).toBe(""); expect(document.activeElement).toBe(draft);
    await type(draft, "Retorno"); await click(button(form.host, "Adicionar serviço"));
    expect(form.state.names).toEqual(["Consulta de neurologia", "Retorno"]); expect(form.host.textContent).toContain("2/100 serviços");
    expect(form.host.querySelector('[aria-live="polite"]')?.textContent).toContain("2/100 serviços");
    expect(button(form.host, "Adicionar serviço").querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("edits a name on Enter and blur without losing its accessible label", async () => {
    const form = await render(["Consulta", "Retorno"]);
    const first = input(form.host, "Serviço 1"); await type(first, "  Consulta inicial  "); await enter(first);
    expect(form.state.names).toEqual(["Consulta inicial", "Retorno"]); expect(first.value).toBe("Consulta inicial");
    const second = input(form.host, "Serviço 2"); await type(second, "Consulta de retorno");
    await act(async () => second.blur());
    expect(form.state.names).toEqual(["Consulta inicial", "Consulta de retorno"]);
    expect(second.getAttribute("aria-invalid")).toBe("false");
  });

  it("rejects empty and whitespace-only additions or edits with linked accessible feedback", async () => {
    const form = await render(["Consulta"]), draft = input(form.host, "Novo serviço");
    await type(draft, "   "); await click(button(form.host, "Adicionar serviço"));
    expect(form.state.changes).toEqual([]); expect(form.host.querySelector('[role="alert"]')?.textContent).toContain("Digite o nome");
    expect(draft.getAttribute("aria-invalid")).toBe("true"); expect(document.activeElement).toBe(draft);
    const alert = form.host.querySelector('[role="alert"]')!; expect(draft.getAttribute("aria-describedby")).toContain(alert.id);
    const row = input(form.host, "Serviço 1"); await type(row, ""); await enter(row);
    expect(row.value).toBe("Consulta"); expect(form.state.names).toEqual(["Consulta"]); expect(form.state.changes).toEqual([]);
    expect(row.getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects case/compatibility duplicates on add and edit", async () => {
    const form = await render(["Consulta", "Retorno"]), draft = input(form.host, "Novo serviço");
    for (const name of ["  CONSULTA  ", "Ｃｏｎｓｕｌｔａ"]) {
      await type(draft, name); await enter(draft);
      expect(form.host.querySelector('[role="alert"]')?.textContent).toContain("já está na lista");
      expect(form.state.changes).toEqual([]);
    }
    const second = input(form.host, "Serviço 2"); await type(second, " consulta "); await enter(second);
    expect(second.value).toBe("Retorno"); expect(form.state.names).toEqual(["Consulta", "Retorno"]);
  });

  it("removes names through explicit buttons, moves focus and supports an empty saved list", async () => {
    const form = await render(["Consulta", "Retorno"]);
    await click(button(form.host, "Remover Consulta"));
    expect(form.state.names).toEqual(["Retorno"]); expect(document.activeElement).toBe(input(form.host, "Serviço 1"));
    await click(button(form.host, "Remover Retorno"));
    expect(form.state.names).toEqual([]); expect(form.host.querySelector("li")).toBeNull();
    expect(form.host.textContent).toContain("Adicione o primeiro serviço"); expect(document.activeElement).toBe(input(form.host, "Novo serviço"));
  });

  it("enforces 100 names and reopens addition after removing one", async () => {
    const form = await render(Array.from({ length: 100 }, (_, index) => "Serviço " + (index + 1)));
    expect(button(form.host, "Adicionar serviço").disabled).toBe(true); expect(input(form.host, "Novo serviço").disabled).toBe(true);
    expect(form.host.textContent).toContain("100/100 serviços");
    await click(button(form.host, "Remover Serviço 1"));
    const draft = input(form.host, "Novo serviço"); expect(draft.disabled).toBe(false); expect(button(form.host, "Adicionar serviço").disabled).toBe(false);
    await type(draft, "Novo atendimento"); await enter(draft);
    expect(form.state.names).toHaveLength(100); expect(form.state.names.at(-1)).toBe("Novo atendimento");
  });

  it("accepts 160 characters but rejects an overlong input even if a program bypasses maxLength", async () => {
    const form = await render(), draft = input(form.host, "Novo serviço"); expect(draft.maxLength).toBe(160);
    await type(draft, "A".repeat(161)); await enter(draft);
    expect(form.state.changes).toEqual([]); expect(form.host.querySelector('[role="alert"]')?.textContent).toContain("160 caracteres");
    await type(draft, "A".repeat(160)); await enter(draft);
    expect(form.state.names).toEqual(["A".repeat(160)]);
    const row = input(form.host, "Serviço 1"); expect(row.maxLength).toBe(160);
    await type(row, "B".repeat(161)); await enter(row);
    expect(row.value).toBe("A".repeat(160)); expect(form.state.names).toEqual(["A".repeat(160)]);
  });

  it("disables addition editing and removal without emitting changes", async () => {
    const form = await render(["Consulta"], "services", true);
    expect(Array.from(form.host.querySelectorAll("input")).every(control => control.disabled)).toBe(true);
    expect(Array.from(form.host.querySelectorAll("button")).every(control => control.disabled)).toBe(true);
    await click(button(form.host, "Remover Consulta")); await click(button(form.host, "Adicionar serviço"));
    await type(input(form.host, "Novo serviço"), "Novo nome"); await enter(input(form.host, "Novo serviço"));
    expect(form.state.names).toEqual(["Consulta"]); expect(form.state.changes).toEqual([]);
    await form.update({ disabled: false }); expect(input(form.host, "Serviço 1").disabled).toBe(false);
  });
});
