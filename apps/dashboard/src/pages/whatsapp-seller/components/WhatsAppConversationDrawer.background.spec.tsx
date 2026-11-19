/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../../api-client.js";
import { useWhatsAppConversations } from "../useWhatsAppConversations.js";
import { WhatsAppConversationDrawer } from "./WhatsAppConversationDrawer.js";
import type { ConversationContext, ConversationDetail, ConversationMessage } from "../conversation-types.js";

const context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubGlobal("crypto", { randomUUID }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllGlobals(); });
const button = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(row => row.textContent?.trim() === "Enviar resposta")!;
async function enter(value: string) {
  const input = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function fixture() {
  const messages: ConversationMessage[] = [];
  const detail: ConversationDetail = { ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Original request", createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z" },
    binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
    channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages, has_more: false, next_cursor: null };
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  let holdNext = false, held: ((response: Response) => void) | undefined;
  let changed: (value: unknown) => void = () => {}, vm!: ReturnType<typeof useWhatsAppConversations>;
  const socket = { connected: true, joinTicket: () => {}, leaveTicket: () => {}, onNewMessage: () => () => {},
    onCaseUpdated: (fn: (value: unknown) => void) => { changed = fn; return () => { changed = () => {}; }; } };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, path, body });
    if (method === "GET" && path.endsWith("/conversations")) return Response.json({ data: [{ ...detail.ticket, binding: detail.binding }], has_more: false, next_cursor: null });
    if (method === "GET" && path.endsWith("/ticket-a")) {
      if (holdNext) { holdNext = false; return new Promise<Response>(resolve => { held = resolve; }); }
      return Response.json(detail);
    }
    if (method === "POST" && path.endsWith("/messages")) {
      const row: ConversationMessage = { id: "canonical-message-a", ticketId: "ticket-a", senderType: "merchant", content: body.content, clientMessageId: body.clientMessageId, createdAt: "2026-11-19T10:01:00Z", delivery: { status: "accepted", revision: 1 } };
      messages.push(row); return Response.json(row);
    }
    throw Error("unexpected_background_test_request");
  } });
  function App() { vm = useWhatsAppConversations({ context, api, socket }); return <WhatsAppConversationDrawer context={context} api={api} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const release = async (failed = false) => { await act(async () => { const done = held; held = undefined; done?.(failed ? Response.json({ detail: "private_read_failure" }, { status: 503 }) : Response.json(detail)); }); };
  cleanup.push(async () => { await release(); await act(async () => root.unmount()); host.remove(); });
  await act(async () => root.render(<App />)); await act(async () => vm.open("ticket-a"));
  return { get vm() { return vm; }, requests, messages, release,
    async background() { holdNext = true; await act(async () => changed({ ticketId: "ticket-a" })); },
    holdForeground() { holdNext = true; },
    withdrawOwnership() { detail.binding = { ...detail.binding!, epoch: 3, assignedOperatorId: "operator-b" }; } };
}

describe("T62 background reconciliation preserves the explicit send gesture and live authority", () => {
  it("keeps the authorized reply clickable during a pending background read and submits one exact accepted intent", async () => {
    const f = await fixture(); await enter("Resposta explicita"); expect(button().disabled).toBe(false);
    await f.background();
    expect(document.querySelector("textarea")!.value).toBe("Resposta explicita");
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    const submitted = f.requests.filter(row => row.method === "POST");
    expect(submitted).toHaveLength(1); expect(submitted[0]!.path.endsWith("/ticket-a/messages")).toBe(true);
    expect(submitted[0]!.body).toMatchObject({ content: "Resposta explicita" });
    expect(typeof submitted[0]!.body!.clientMessageId).toBe("string");
    expect(button().disabled).toBe(true);
    await f.release();
    expect(document.querySelector("textarea")!.value).toBe("");
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toMatchObject({ ticketId: "ticket-a", content: "Resposta explicita", clientMessageId: submitted[0]!.body!.clientMessageId, delivery: { status: "accepted", revision: 1 } });
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Aceita pelo canal");
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("Lida");
    expect(f.requests.filter(row => row.method === "POST")).toHaveLength(1);
  });
  it("a failed background read disables replies and preserves the unsent draft with a real read error", async () => {
    const f = await fixture(); await enter("Rascunho seguro"); await f.background(); await f.release(true);
    expect(button().disabled).toBe(true); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("private_read_failure");
    expect(document.querySelector("textarea")!.value).toBe("Rascunho seguro");
    await act(async () => button().click());
    expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
  });
  it("a background response with another operator immediately revokes send without losing the draft", async () => {
    const f = await fixture(); await enter("Rascunho seguro"); await f.background(); f.withdrawOwnership(); await f.release();
    expect(f.vm.detail?.binding?.assignedOperatorId).toBe("operator-b"); expect(f.vm.detail?.binding?.epoch).toBe(3);
    expect(document.body.textContent).toContain("outro operador"); expect(button().disabled).toBe(true);
    expect(document.querySelector("textarea")!.value).toBe("Rascunho seguro");
    await act(async () => button().click()); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
  });
  it("an explicit foreground history reload still blocks commands until its canonical response", async () => {
    const f = await fixture(); await enter("Rascunho seguro"); f.holdForeground();
    let read!: Promise<void>; await act(async () => { read = f.vm.open("ticket-a"); });
    expect(f.vm.detailLoading).toBe(true); expect(button().disabled).toBe(true);
    await act(async () => button().click()); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
    await f.release(); await act(async () => { await read; });
    expect(button().disabled).toBe(false); expect(document.querySelector("textarea")!.value).toBe("Rascunho seguro");
  });
});
