import { describe, expect, it, vi } from "vitest";
import { recoveryTestFeedback, sendRecoveryTest } from "./recovery-test-send.js";

describe("cart recovery test outcomes", () => {
  it.each([
    ["whatsapp_template", "WhatsApp"],
    ["email", "e-mail"],
  ])("reports provider acceptance on the actual %s channel", (channel, label) => {
    expect(recoveryTestFeedback({ sent: true, status: "sent", channel, messageId: "provider-id" }))
      .toEqual({ type: "success", text: `Teste aceito para envio por ${label}.` });
  });

  it.each([
    { sent: false, status: "skipped", channel: "none", reason: "no_reachable_channel" },
    { sent: false, status: "failed", channel: "whatsapp_template", reason: "twilio_400" },
    { sent: false, status: "uncertain", channel: "email" },
    { sent: false, status: "sent", channel: "email", messageId: "id" },
    { sent: true, status: "sent", channel: "email" },
    { sent: true, status: "sent", channel: "none", messageId: "id" },
    { sent: true, status: "sent", channel: "bubblewhats", messageId: "id" },
    { sent: true },
    {},
    null,
  ])("does not show success for missing or unconfirmed acceptance: %j", (value) => {
    expect(recoveryTestFeedback(value).type).toBe("error");
  });

  it("explains the email fallback when no channel is available", () => {
    expect(recoveryTestFeedback({ sent: false, status: "skipped", channel: "none" }).text)
      .toContain("Informe um e-mail");
  });

  it.each(["whatsapp_template", "email"])("asks to verify receipt before retrying an uncertain %s send", (channel) => {
    expect(recoveryTestFeedback({ sent: false, status: "uncertain", channel }).text)
      .toContain("Confira o recebimento antes de repetir");
  });

  it("sends only entered recipients with authentication and no invented session or incentive", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      sent: true, status: "sent", channel: "email", messageId: "email-id",
    }), { status: 200 }));
    const feedback = await sendRecoveryTest("https://api.example.test", {
      phone: "  +5511999999999  ", email: "  owner@example.test  ",
    }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/cart-recovery/test-send");
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(String(init?.body))).toEqual({ phone: "+5511999999999", email: "owner@example.test" });
    expect(feedback.text).toContain("e-mail");
  });

  it("accepts an email-only test", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      sent: false, status: "skipped", channel: "none",
    }), { status: 200 }));
    const feedback = await sendRecoveryTest("https://api.example.test", { email: "owner@example.test" }, fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ email: "owner@example.test" });
    expect(feedback.type).toBe("error");
  });

  it("does not submit an empty recipient", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect((await sendRecoveryTest("https://api.example.test", { phone: "  " }, fetchImpl)).type).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates HTTP failure without reporting a sent message", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(sendRecoveryTest("https://api.example.test", { email: "owner@example.test" }, fetchImpl)).rejects.toThrow();
  });
});
