/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanonicalSupportChat } from "./CanonicalSupportChat.js";
import type { ConversationMessage } from "../../whatsapp-seller/conversation-types.js";

const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => {
  for (const { root, host } of mounts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function fixture(initialStatus: "accepted" | "unknown") {
  const sent: string[] = [];
  let receipt: ConversationMessage;
  let publish!: (row: ConversationMessage) => void;
  function App() {
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    publish = row => setMessages([row]);
    return <CanonicalSupportChat ticketId="ticket-draft" connected busy={false} actionError={null}
      status="in_progress" statusOptions={[]} onStatus={() => {}} onClose={() => {}}
      whatsapp={{ messages, loading: false, error: null, canSend: true, hasMore: false,
        reload: () => {}, loadMore: async () => {}, modeLabel: "Atendimento humano com você", sendHint: "Revise sua resposta.",
        onSend: async content => {
          sent.push(content);
          receipt = { id: "message-draft", ticketId: "ticket-draft", clientMessageId: "intent-draft",
            senderType: "merchant", content, createdAt: "2026-11-19T10:00:00Z", delivery: { status: initialStatus, revision: 1 } };
          setMessages([receipt]);
          return receipt;
        } }} />;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounts.push({ root, host });
  await act(async () => root.render(<App />));
  return { sent, async accept() {
    await act(async () => publish({ ...receipt, delivery: { status: "accepted", revision: 2 } }));
  } };
}
async function enter(value: string) {
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  const control = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Enviar resposta")!;
  expect(control.disabled).toBe(false);
  await act(async () => control.click());
}

describe("T61 accepted intent and the original draft text", () => {
  it("normalizes the outgoing payload and clears the unchanged original text on acceptance", async () => {
    const f = await fixture("accepted");
    await enter("  Resposta para o cliente.\n");
    await send();
    expect(f.sent).toEqual(["Resposta para o cliente."]);
    expect(document.querySelector("textarea")!.value).toBe("");
  });
  it("keeps the original uncertain text until that exact intent is accepted", async () => {
    const f = await fixture("unknown"), original = "  Aguardo sua confirmação. \n";
    await enter(original);
    await send();
    expect(document.querySelector("textarea")!.value).toBe(original);
    await f.accept();
    expect(f.sent).toEqual(["Aguardo sua confirmação."]);
    expect(document.querySelector("textarea")!.value).toBe("");
  });
  it("does not erase a later edit when its normalized content matches the prior intent", async () => {
    const f = await fixture("unknown");
    await enter("  Resposta em revisão. ");
    await send();
    await enter("Resposta em revisão.");
    await f.accept();
    expect(f.sent).toEqual(["Resposta em revisão."]);
    expect(document.querySelector("textarea")!.value).toBe("Resposta em revisão.");
  });
});
