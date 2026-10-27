// Run after the API build. Exercises the actual controller, guard, use cases,
// browser helper and a Chromium platform authenticator without production data.
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const apiRoot = path.resolve(__dirname, "../../api");
const apiRequire = createRequire(path.join(apiRoot, "package.json"));
const load = relative => import(pathToFileURL(path.join(apiRoot, "dist/modules/buyer-account", relative + ".js")).href);

async function run() {
  apiRequire("reflect-metadata");
  const { Module, ValidationPipe } = apiRequire("@nestjs/common");
  const { NestFactory } = apiRequire("@nestjs/core");
  const names = [
    ["presentation/http/buyer-webauthn.controller", "BuyerWebAuthnController"],
    ["application/use-cases/webauthn-register-options.use-case", "WebAuthnRegisterOptionsUseCase"],
    ["application/use-cases/webauthn-register-verify.use-case", "WebAuthnRegisterVerifyUseCase"],
    ["application/use-cases/webauthn-login-options.use-case", "WebAuthnLoginOptionsUseCase"],
    ["application/use-cases/webauthn-login-verify.use-case", "WebAuthnLoginVerifyUseCase"],
    ["domain/services/buyer-jwt.service", "BuyerJwtService"],
    ["domain/services/webauthn-challenge.service", "WebAuthnChallengeService"],
    ["domain/services/webauthn-verifier.service", "WebAuthnVerifierService"],
    ["infrastructure/in-memory-buyer-account.repository", "InMemoryBuyerAccountRepository"],
    ["infrastructure/in-memory-webauthn-credential-store", "InMemoryWebAuthnCredentialStore"],
    ["domain/entities/buyer-account.entity", "BuyerAccount"],
  ];
  const C = {};
  for (const [file, name] of names) C[name] = (await load(file))[name];
  const buyerRepo = new C.InMemoryBuyerAccountRepository();
  const buyer = new C.BuyerAccount({ globalUserId: "browser_test_buyer", email: "browser@example.invalid",
    displayName: "Browser Test", passwordHash: "test-only", createdAt: new Date(), updatedAt: new Date() });
  await buyerRepo.save(buyer);
  const jwt = new C.BuyerJwtService("local-browser-test-secret-at-least-32-characters");
  const deps = { buyerRepo, jwt, challengeService: new C.WebAuthnChallengeService(),
    credentialStore: new C.InMemoryWebAuthnCredentialStore(),
    verifier: new C.WebAuthnVerifierService({ rpId: "localhost", origin: "http://localhost:5176" }) };
  class TestModule {}
  Module({ controllers: [C.BuyerWebAuthnController], providers: [
    { provide: C.BuyerJwtService, useValue: jwt },
    { provide: C.WebAuthnRegisterOptionsUseCase, useValue: new C.WebAuthnRegisterOptionsUseCase(deps.challengeService, { rpId: "localhost", rpName: "Zyon test" }, buyerRepo) },
    { provide: C.WebAuthnRegisterVerifyUseCase, useValue: new C.WebAuthnRegisterVerifyUseCase(deps) },
    { provide: C.WebAuthnLoginOptionsUseCase, useValue: new C.WebAuthnLoginOptionsUseCase({ ...deps, rpId: "localhost" }) },
    { provide: C.WebAuthnLoginVerifyUseCase, useValue: new C.WebAuthnLoginVerifyUseCase(deps) },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const browserCode = ["buyer-auth.ts", "buyer-webauthn.ts"].map(file =>
    ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8").replace(/^import .*from "\.\/buyer-auth";/m, ""),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  ).join("\n");
  app.getHttpAdapter().get("/", (_req, res) => res.type("html").send(
    '<html><body><button id="enroll">Enroll</button><button id="login">Login</button><script type="module">' +
    'const process = {env:{NEXT_PUBLIC_API_BASE_URL:"/api/v1"}};\n' + browserCode +
    '\nwindow.biometric={registerBuyerPasskey,loginBuyerPasskey,clearBuyerSession,biometricError};' +
    'for(const [id,fn] of [["enroll",registerBuyerPasskey],["login",loginBuyerPasskey]]) document.getElementById(id).onclick=()=>{window.result=null;fn().then(value=>window.result={ok:true,value}).catch(error=>window.result={ok:false,message:biometricError(error)});};</script></body></html>'
  ));
  await app.listen(5176, "127.0.0.1");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await page.goto("http://localhost:5176");
    const unauthenticated = await page.request.post("http://localhost:5176/api/v1/buyer/webauthn/register/options", { data: {} });
    assert.equal(unauthenticated.status(), 401);
    await page.evaluate(token => localStorage.setItem("zyon_buyer_token", token),
      jwt.sign({ globalUserId: buyer.globalUserId, email: buyer.email }));
    await page.click("#enroll");
    await page.waitForFunction(() => window.result !== null);
    assert.equal((await page.evaluate(() => window.result)).ok, true);
    const credentials = await deps.credentialStore.listByGlobalUserId(buyer.globalUserId);
    assert.equal(credentials.length, 1);
    await page.evaluate(() => window.biometric.clearBuyerSession());
    await page.click("#login");
    await page.waitForFunction(() => window.result !== null);
    assert.deepEqual(await page.evaluate(() => window.result), { ok: true, value: buyer.globalUserId });
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem("aacp_buyer_auth_session")));
    assert.equal(jwt.verify(session.access_token).globalUserId, buyer.globalUserId);
    assert.ok(session.expires_at > Date.now());
    await page.evaluate(() => {
      navigator.credentials.get = async () => { throw new DOMException("Cancelled", "NotAllowedError"); };
    });
    await page.click("#login");
    await page.waitForFunction(() => window.result !== null);
    const cancelled = await page.evaluate(() => window.result);
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.message, /e-mail/);
    assert.equal(await page.evaluate(() => localStorage.getItem("zyon_buyer_token")), session.access_token);
    console.log("PASS: registration guard, native browser enrollment, discoverable login, verified JWT, hub session and cancellation fallback.");
  } finally {
    await browser.close();
    await app.close();
  }
}
run().catch(error => { console.error(error); process.exit(1); });
