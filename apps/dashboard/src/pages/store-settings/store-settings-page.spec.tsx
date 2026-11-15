/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { CompanyAboutField } from "./CompanyAboutField.js";

it("T16", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Form() { const [value, setValue] = useState(""); return <CompanyAboutField value={value} onChange={setValue} />; }
  try {
    await act(async () => root.render(<Form />));
    const label = Array.from(host.querySelectorAll("label")).find(item => item.textContent === "Sobre a empresa")!;
    const textarea = document.getElementById(label.htmlFor) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA"); expect(textarea.maxLength).toBe(1200);
    textarea.focus(); expect(document.activeElement).toBe(textarea);
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(textarea, "Empresa sintética"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(textarea.value).toBe("Empresa sintética");
    const help = document.getElementById(textarea.getAttribute("aria-describedby")!)!;
    expect(help.textContent).toContain("Texto público"); expect(help.textContent).toContain("17/1.200");
    expect(help.textContent).toContain("Não inclua dados privados de clientes");
    await act(async () => { setValue.call(textarea, ""); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(textarea.value).toBe(""); expect(help.textContent).toContain("0/1.200");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
