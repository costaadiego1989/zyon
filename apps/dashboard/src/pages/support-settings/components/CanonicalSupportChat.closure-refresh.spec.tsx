/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalSupportChat } from "./CanonicalSupportChat.js";
import type { ConversationMessage } from "../../whatsapp-seller/conversation-types.js";

const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  for (const { root, host } of mounts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function button(name: string) {
  const control = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find(value => value.getAttribute("aria-label") === name || value.textContent?.trim() === name);
  expect(control, name).toBeTruthy();
  return control!;
}
async function click(name: string) { await act(async () => button(name).click()); }
async function enter(value: string) {
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function fixture({ holdSend = false } = {}) {
  const refresh = deferred<void>(), send = deferred<ConversationMessage | undefined>();
  const onClose = vi.fn(), onStatus = vi.fn();
  let publishCanonicalClosed!: () => void;
  let setOperationBusy!: (value: boolean) => void;
  const unknown: ConversationMessage = { id: "message-unknown", ticketId: "ticket-close-race", clientMessageId: "intent-unknown",
    senderType: "merchant", content: "Resposta sem confirmacao", createdAt: "2026-11-26T18:00:00Z",
    delivery: { status: "unknown", revision: 1 } };
  function App() {
    const [open, setOpen] = useState(false), [status, setStatus] = useState("in_progress"), [busy, setBusy] = useState(false);
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    publishCanonicalClosed = () => setStatus("closed");
    setOperationBusy = setBusy;
    return <><button type="button" onClick={() => setOpen(true)}>Abrir conversa</button>{open &&
      <CanonicalSupportChat ticketId="ticket-close-race" connected busy={busy} actionError={null} status={status}
        statusOptions={status === "closed" ? [] : [{ value: "closed", label: "Encerrar e retomar IA" }]}
        onStatus={value => {
          onStatus(value); setBusy(true);
          // The canonical detail can arrive before a coalesced refresh finishes.
          // Keep the command busy until that separate deferred read settles.
          void refresh.promise.then(() => setBusy(false));
        }} onClose={() => { onClose(); setOpen(false); }}
        whatsapp={{ messages, loading: false, error: null, canSend: true, hasMore: false,
          reload: () => {}, loadMore: async () => {}, modeLabel: status === "closed" ? "Atendimento humano encerrado · IA ativa" : "Atendimento humano com voce",
          sendHint: "Revise sua resposta.", onSend: async () => {
            if (holdSend) return send.promise;
            setMessages([unknown]); return unknown;
          } }} />}</>;
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(<App />));
  const opener = button("Abrir conversa"); opener.focus(); await click("Abrir conversa");
  return { opener, onClose, onStatus,
    async canonicalClosed() { await act(async () => publishCanonicalClosed()); },
    async operationBusy() { await act(async () => setOperationBusy(true)); },
    async finishRefresh() { await act(async () => { refresh.resolve(); await refresh.promise; }); },
    async finishSend() { await act(async () => { send.resolve(undefined); await send.promise; }); },
  };
}

describe("T61 canonical closure while reconciliation is still pending", () => {
  it("dismisses a canonically closed drawer on the first close click and restores focus before refresh settles", async () => {
    const f = await fixture();
    await enter("Resposta sem confirmacao"); await click("Enviar resposta");
    expect(document.querySelector("textarea")!.value).toBe("Resposta sem confirmacao");
    await click("Encerrar e retomar IA");
    expect(button("Encerrar sem enviar")).toBeTruthy();
    await click("Encerrar sem enviar"); expect(f.onStatus).toHaveBeenCalledTimes(1); expect(f.onStatus).toHaveBeenCalledWith("closed");
    await f.canonicalClosed();
    expect(document.body.textContent).toContain("Atendimento humano encerrado · IA ativa");
    expect(document.querySelector("textarea")).toBeNull();
    await click("Fechar");
    expect(f.onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(f.opener);
    await f.finishRefresh();
    expect(f.onStatus).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps the existing protection while an open-case operation is still pending", async () => {
    const f = await fixture(); await f.operationBusy(); await click("Fechar");
    expect(f.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("keeps an unresolved local send protected even when another actor has already closed the case", async () => {
    const f = await fixture({ holdSend: true });
    await enter("Resposta em envio"); await click("Enviar resposta");
    await f.canonicalClosed(); await click("Fechar");
    expect(f.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await f.finishSend(); await click("Fechar");
    expect(f.onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(f.opener);
  });
});
