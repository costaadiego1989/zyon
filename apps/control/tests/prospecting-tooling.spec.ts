import { afterEach, expect, test } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Deliberately a tooling probe, not a substitute for any prospecting screen's
// acceptance tests. It verifies the DOM/event/async primitives those tests use.
function AsyncControlProbe({ load }: { load: () => Promise<"empty" | "forbidden"> }) {
  const [state, setState] = useState("idle");
  return createElement("section", null,
    createElement("button", { disabled: state === "loading", onClick: async () => {
      setState("loading");
      try { setState(await load()); } catch { setState("error"); }
    } }, "Pesquisar"),
    createElement("p", { role: state === "error" || state === "forbidden" ? "alert" : "status", "aria-live": "polite" },
      ({ idle: "Aguardando", loading: "Carregando", empty: "Nenhuma empresa", error: "Falha ao carregar", forbidden: "Sem acesso" } as Record<string, string>)[state]),
  );
}
const roots: Root[] = [];
afterEach(async () => { await act(async () => { for (const root of roots.splice(0)) root.unmount(); }); document.body.replaceChildren(); });

test("PROS-24 AC3 Control tooling renders loading, empty, error and forbidden through real button events", async () => {
  for (const outcome of ["empty", "error", "forbidden"] as const) {
    let resolve!: (value: "empty" | "forbidden") => void; let reject!: (error: Error) => void;
    const pending = new Promise<"empty" | "forbidden">((res, rej) => { resolve = res; reject = rej; });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => { root.render(createElement(AsyncControlProbe, { load: () => pending })); });
    const button = host.querySelector("button")!;
    button.focus(); expect(document.activeElement).toBe(button); expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Carregando");
    expect(button.disabled).toBe(true);
    await act(async () => { if (outcome === "error") reject(new Error("controlled_failure")); else resolve(outcome); await pending.catch(() => {}); });
    expect(host.querySelector(outcome === "empty" ? '[role="status"]' : '[role="alert"]')?.textContent).toBe({ empty: "Nenhuma empresa", error: "Falha ao carregar", forbidden: "Sem acesso" }[outcome]);
    expect(button.disabled).toBe(false);
    await act(async () => { root.unmount(); }); roots.splice(roots.indexOf(root), 1); host.remove();
  }
});
