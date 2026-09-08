import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailOtpFrom, buildEmailOtpMessage } from "./email-otp-template.js";
import { ResendEmailOtpSender } from "./resend-email-otp-sender.js";

test("OTP email contains merchant identity, six-digit code, ten-minute validity and plain text", () => {
  const message = buildEmailOtpMessage("123456", { merchantName: "Essência Lab" });
  assert.equal(message.subject, "Essência Lab · Seu código de acesso");
  for (const body of [message.html, message.text]) {
    assert.ok(body.includes("Essência Lab"));
    assert.ok(body.includes("123456"));
    assert.ok(body.includes("10 minutos"));
    assert.ok(body.includes("Volte à loja"));
    assert.ok(body.includes("Não solicitou este código?"));
  }
  assert.match(message.html, /<html lang="pt-BR">/);
  assert.match(message.html, /role="presentation"/);
  assert.doesNotMatch(message.html, /\b(?:src|href)\s*=/i);
});

test("OTP email escapes merchant HTML and removes subject control characters", () => {
  const message = buildEmailOtpMessage("123456", { merchantName: 'Loja <img src=x onerror="alert(1)"> & Filhos\r\nBcc: attacker@example.test' });
  assert.ok(message.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Filhos"));
  assert.doesNotMatch(message.html, /<img/i);
  assert.doesNotMatch(message.subject, /[\r\n\u0000-\u001f]/);
  assert.ok(message.text.includes('Loja <img src=x onerror="alert(1)"> & Filhos Bcc: attacker@example.test'));
});

test("OTP email falls back to Zyon and rejects arbitrary code markup", () => {
  for (const context of [undefined, { merchantName: " \r\n " }]) {
    const message = buildEmailOtpMessage("654321", context);
    assert.equal(message.subject, "Zyon · Seu código de acesso");
    assert.ok(message.html.includes("Zyon"));
  }
  for (const code of ["12345", "1234567", "<script>", "12 3456", "123456\n"]) {
    assert.throws(() => buildEmailOtpMessage(code), /otp_email_code_invalid/);
  }
});

test("Resend sends branded HTML and plain text using only the configured sender", async () => {
  let sent: Record<string, string> | undefined;
  const sender = new ResendEmailOtpSender({ apiKey: "test-key", fromEmail: "verified@example.test" }, {
    fetch: async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      return new Response("accepted", { status: 202 });
    },
  });
  await sender.send("buyer@example.test", "123456", { merchantName: "Loja do Teste" });
  assert.equal(sent?.from, '"Loja do Teste via Zyon" <verified@example.test>');
  assert.equal(sent?.to, "buyer@example.test");
  assert.ok(sent?.subject.includes("Loja do Teste"));
  assert.ok(sent?.html.includes("123456"));
  assert.ok(sent?.text.includes("123456"));
});

test("sender display name replaces a configured brand without changing its verified mailbox", () => {
  const context = { merchantName: "Loja do Catálogo" };
  for (const configured of ["verified@example.test", "Existing Brand <verified@example.test>", '"Existing Brand" <verified@example.test>']) {
    assert.equal(buildEmailOtpFrom(configured, context), '"Loja do Catálogo via Zyon" <verified@example.test>');
  }
  assert.equal(buildEmailOtpFrom("Existing Brand <verified@example.test>"), '"Zyon" <verified@example.test>');
});

test("sender display name neutralizes header injection and rejects malformed configured mailboxes", () => {
  const from = buildEmailOtpFrom("verified@example.test", { merchantName: 'Loja "Especial"\r\nBcc: attacker@example.test' });
  assert.doesNotMatch(from, /[\r\n\u0000-\u001f]/);
  assert.ok(from.startsWith('"Loja \\"Especial\\" Bcc: attacker@example.test via Zyon"'));
  assert.ok(from.endsWith(" <verified@example.test>"));
  for (const invalid of ["verified@example.test\r\nBcc: attacker@example.test", "x@example.test, y@example.test", "Brand <a@example.test> <b@example.test>", "", "not-an-email"]) {
    assert.throws(() => buildEmailOtpFrom(invalid), /otp_email_sender_invalid/);
  }
});

test("invalid configured sender fails before contacting Resend", async () => {
  let requested = false;
  const sender = new ResendEmailOtpSender({ apiKey: "test-key", fromEmail: "verified@example.test\r\nBcc: attacker@example.test" }, {
    fetch: async () => { requested = true; return new Response("accepted", { status: 202 }); },
  });
  await assert.rejects(sender.send("buyer@example.test", "123456", { merchantName: "Loja" }), /otp_email_unavailable/);
  assert.equal(requested, false);
});
