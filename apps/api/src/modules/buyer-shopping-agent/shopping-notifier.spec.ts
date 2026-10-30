import { test } from "node:test";
import assert from "node:assert/strict";
import { ShoppingNotifierService } from "./infrastructure/shopping-notifier.service.js";
import type { ShoppingActivity } from "./domain/shopping-agent.js";

function fixture() {
  const emails: any[] = [], messages: any[] = [];
  const preference = { emailOptIn: true, whatsappOptIn: true };
  const buyer = { email: "buyer@example.test", phone: "+5511999999999", displayName: "<Compradora>" };
  const merchant = { name: "Loja", slug: "loja", theme: { logoUrl: "https://cdn.example/loja.png" }, storeSettings: { slug: "slug-persistido", styles: { logoUrl: "https://cdn.example/styles.png" } } };
  let result: any = { status: "sent", messageId: "provider-id" };
  const service = new ShoppingNotifierService(
    { async send(input: unknown) { emails.push(input); return result; } } as any,
    { async execute(input: unknown) { messages.push(input); return result; } } as any,
    { async findByGlobalUserId() { return buyer; } } as any,
    { async getProfile() { return merchant; } } as any,
    { buyerPreference: { async findUnique() { return preference; } } } as any,
  );
  const activity: ShoppingActivity = { id: "activity", taskId: "task", taskRevision: 1, key: "task:1:1", createdAt: new Date().toISOString(),
    kind: "opportunity", message: "Confira <script>alert(1)</script>", decision: "pending", deliveries: {} };
  const send = (channel: "email" | "whatsapp") => service.send({ buyerId: "buyer", merchantId: "merchant", activity, channel });
  return { send, preference, buyer, merchant, emails, messages, setResult(value: unknown) { result = value; } };
}
test("agent email escapes user content and requires provider acceptance with a stable idempotency key", async () => {
  const f = fixture(); assert.equal((await f.send("email")).status, "sent");
  assert.equal(f.emails[0].requireDelivery, true); assert.equal(f.emails[0].idempotencyKey, "shopping-agent/activity/email");
  assert.ok(!f.emails[0].html.includes("<script>")); assert.ok(f.emails[0].html.includes("&lt;Compradora&gt;"));
  assert.match(f.emails[0].html, /\/store\/loja\?agent=activity/);
  assert.match(f.emails[0].html, /src="https:\/\/cdn.example\/loja.png"/);
  assert.match(f.emails[0].from, /^"Loja via Zyon" </);
});
test("persisted store slug and settings logo are used when the profile has no direct values", async () => {
  const f = fixture(); f.merchant.slug = ""; f.merchant.theme.logoUrl = "";
  delete (f.merchant as any).slug;
  await f.send("email");
  assert.match(f.emails[0].html, /\/store\/slug-persistido\?agent=activity/);
  assert.match(f.emails[0].html, /src="https:\/\/cdn.example\/styles.png"/);
});
test("existing global channel opt-outs suppress the corresponding agent message", async () => {
  const f = fixture(); f.preference.emailOptIn = false; f.preference.whatsappOptIn = false;
  assert.equal((await f.send("email")).status, "skipped"); assert.equal((await f.send("whatsapp")).status, "skipped");
  assert.equal(f.emails.length + f.messages.length, 0);
});
test("the agent requests only the official template and never supplies an alternate channel", async () => {
  const f = fixture(); assert.equal((await f.send("whatsapp")).status, "sent");
  assert.equal(f.messages[0].type, "shopping_agent_alert"); assert.equal(f.messages[0].merchantId, "merchant");
  assert.equal(f.messages[0].fallbackEmail, undefined); assert.equal(f.messages[0].freeformText, undefined); assert.equal(f.emails.length, 0);
});
test("missing phone and an unconfigured email transport never appear as successful sends", async () => {
  const f = fixture(); f.buyer.phone = ""; f.setResult({ status: "skipped", messageId: "" });
  assert.equal((await f.send("whatsapp")).status, "skipped"); assert.equal((await f.send("email")).status, "skipped");
  assert.equal(f.messages.length, 0);
});
test("uncertain WhatsApp acceptance remains uncertain without sending an email", async () => {
  const f = fixture(); f.setResult({ status: "uncertain" });
  assert.equal((await f.send("whatsapp")).status, "uncertain"); assert.equal(f.emails.length, 0);
});
