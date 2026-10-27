import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMerchantEmailBranding,
  MERCHANT_EMAIL_FOOTER_SLOT,
  MERCHANT_EMAIL_HEADER_SLOT,
  resolveMerchantEmailBranding,
} from "./merchant-email-branding.js";

test("merchant email branding uses trusted logo, legal registration and social links", () => {
  const brand = resolveMerchantEmailBranding({
    name: "Casa <Aurora>",
    theme: { logoUrl: "https://cdn.example.test/aurora-logo.png", accentColor: "#245e49" },
    storeSettings: {
      company: { cnpj: "12.345.678/0001-90" },
      social: {
        instagram: "https://instagram.com/casaaurora",
        facebook: "https://facebook.com/casaaurora",
        linkedin: "javascript:alert(1)",
      },
    },
  });
  const html = applyMerchantEmailBranding(
    `<!doctype html><html><body>${MERCHANT_EMAIL_HEADER_SLOT}<main>Conteúdo da mensagem</main>${MERCHANT_EMAIL_FOOTER_SLOT}</body></html>`,
    brand,
  );

  assert.match(html, /aurora-logo\.png/);
  assert.match(html, /Casa &lt;Aurora&gt;/);
  assert.match(html, /CNPJ: 12\.345\.678\/0001-90/);
  assert.match(html, /href="https:\/\/instagram\.com\/casaaurora"/);
  assert.match(html, /href="https:\/\/facebook\.com\/casaaurora"/);
  assert.doesNotMatch(html, /javascript:|LinkedIn/);
  assert.doesNotMatch(html, /zyon:merchant-email-(?:header|footer)/);
});

test("merchant email branding augments legacy markup once without unsafe URLs", () => {
  const html = applyMerchantEmailBranding("<body><p>Mensagem</p></body>", resolveMerchantEmailBranding({
    name: "Loja Segura",
    theme: { logoUrl: "http://untrusted.example/logo.png" },
    storeSettings: {
      styles: { logoUrl: "https://cdn.example.test/fallback-logo.png" },
      social: { youtube: "https://youtube.com/@lojasegura" },
    },
  }));

  assert.match(html, /alt="Loja Segura"/);
  assert.match(html, /&copy; .*Loja Segura/);
  assert.match(html, /fallback-logo\.png/);
  assert.match(html, /YouTube/);
  assert.doesNotMatch(html, /untrusted\.example/);
});
