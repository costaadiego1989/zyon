import test from "node:test";
import assert from "node:assert/strict";
import { renderRobotsTxt, UcpRobotsController } from "./ucp-robots.controller.js";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";

// ─── renderRobotsTxt (pure function) ───────────────────────────────────────

test("renderRobotsTxt returns text/plain-friendly output for merchant", () => {
  const out = renderRobotsTxt(
    "Casa Decoração",
    "mrc_casa_decorao",
    "https://casa-decorao.zyon-payments.com.br/sitemap.xml",
  );

  assert(out.includes("# AACP Merchant Robots.txt"));
  assert(out.includes("Generated for merchant: Casa Decoração (mrc_casa_decorao)"));
});

test("renderRobotsTxt allows every major AI crawler", () => {
  const out = renderRobotsTxt("M", "m1", "https://x.com/sitemap.xml");
  for (const ua of [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
  ]) {
    assert(out.includes(`User-agent: ${ua}`), `Missing User-agent: ${ua}`);
    // Each AI bot must have an Allow: / right after its header
    const idx = out.indexOf(`User-agent: ${ua}`);
    const tail = out.slice(idx, idx + 60);
    assert(tail.includes("Allow: /"), `Missing Allow: / for ${ua}`);
  }
});

test("renderRobotsTxt disallows admin/api/checkout/v1 paths for wildcard", () => {
  const out = renderRobotsTxt("M", "m1", "https://x.com/sitemap.xml");
  assert(out.includes("Disallow: /admin/"));
  assert(out.includes("Disallow: /api/"));
  assert(out.includes("Disallow: /checkout"));
  assert(out.includes("Disallow: /v1/"));
});

test("renderRobotsTxt includes sitemap URL", () => {
  const out = renderRobotsTxt("M", "m1", "https://casa.zyon-payments.com.br/sitemap.xml");
  assert(out.includes("Sitemap: https://casa.zyon-payments.com.br/sitemap.xml"));
});

test("renderRobotsTxt includes Googlebot with Allow: /", () => {
  const out = renderRobotsTxt("M", "m1", "https://x.com/sitemap.xml");
  assert(out.includes("User-agent: Googlebot"));
  const idx = out.indexOf("User-agent: Googlebot");
  const tail = out.slice(idx, idx + 60);
  assert(tail.includes("Allow: /"));
});

// ─── UcpRobotsController end-to-end behavior (with fake response) ─────────

function makeRepo() {
  const repo = new InMemoryMerchantRepository();
  repo.seedProfile({
    id: "mrc_casa_decorao",
    name: "Casa Decoração",
    storeSettings: { slug: "casa-decorao" },
  });
  return repo;
}

function makeRes() {
  let sentStatus: number | undefined;
  let sentBody: string | undefined;
  const res: any = {
    status(code: number) {
      sentStatus = code;
      return this;
    },
    send(body: string) {
      sentBody = body;
      return this;
    },
  };
  return { res, getStatus: () => sentStatus, getBody: () => sentBody };
}

test("UcpRobotsController returns 200 + text/plain robots body for merchant host", async () => {
  const controller = new UcpRobotsController(makeRepo());
  const { res, getStatus, getBody } = makeRes();

  await controller.robots(
    { headers: { host: "casa-decorao.zyon-payments.com.br" } } as any,
    res,
  );

  assert.equal(getStatus(), 200);
  const body = getBody()!;
  assert(body.includes("Generated for merchant: Casa Decoração (mrc_casa_decorao)"));
  assert(body.includes("Sitemap: https://casa-decorao.zyon-payments.com.br/sitemap.xml"));
  assert(body.includes("User-agent: GPTBot"));
});

test("UcpRobotsController returns platform robots for api host", async () => {
  const controller = new UcpRobotsController(makeRepo());
  const { res, getStatus, getBody } = makeRes();

  await controller.robots({ headers: { host: "api.zyon-payments.com.br" } } as any, res);

  assert.equal(getStatus(), 200);
  const body = getBody()!;
  assert(body.includes("Generated for merchant: AACP Platform (platform-default)"));
  assert(body.includes("Sitemap: https://zyon-payments.com.br/sitemap.xml"));
});

test("UcpRobotsController returns platform robots when host header missing", async () => {
  const controller = new UcpRobotsController(makeRepo());
  const { res, getStatus, getBody } = makeRes();

  await controller.robots({ headers: {} } as any, res);

  assert.equal(getStatus(), 200);
  const body = getBody()!;
  assert(body.includes("platform-default"));
});

test("UcpRobotsController sitemap uses merchant slug for merchant host", async () => {
  const controller = new UcpRobotsController(makeRepo());
  const { res, getBody } = makeRes();

  await controller.robots(
    { headers: { host: "casa-decorao.zyon-payments.com.br" } } as any,
    res,
  );

  const body = getBody()!;
  // The sitemap URL must include the slug (not "platform-default" nor the host).
  assert(body.includes("https://casa-decorao.zyon-payments.com.br/sitemap.xml"));
});
