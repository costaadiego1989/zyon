import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const appRequire = createRequire(path.join(root, "apps/storefront/package.json"));
const apiRequire = createRequire(path.join(root, "apps/api/package.json"));
const { chromium } = appRequire("@playwright/test");
const ts = apiRequire("typescript");
const files = ["packages/checkout-ui/src/Turnstile.tsx", "apps/storefront/src/components/BuyerLoginForm.tsx", "apps/storefront/src/components/BuyerRegistrationForm.tsx", "apps/dashboard/src/auth/AuthScreen.tsx", "apps/dashboard/src/auth/SignupWizard.tsx", "apps/dashboard/src/utils/masks.ts", "apps/dashboard/src/lib/signup-options.ts"];
files.push("apps/storefront/src/components/buyer-hub/BuyerHubPanel.tsx");
const sources = files.map(file => ts.transpileModule((fs.readFileSync(path.join(root, file), "utf8") + (file.endsWith("BuyerHubPanel.tsx") ? "\nexport { EmailLoginForm };" : "")).replaceAll("import.meta", "({ env: { PROD: true } })"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText);

test("browser auth forms gate requests on fresh CAPTCHA across login, signup, forgot and reset", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    page.setDefaultTimeout(5000);
    page.setDefaultTimeout(5000);
    await page.route("**/*", (route: any) => route.fulfill({ contentType: "text/html", body: '<style>body{margin:12px;font:16px sans-serif}#root{max-width:420px}input{max-width:95%}</style><div id="root"></div>' }));
    await page.goto("http://captcha-local.test/?token=password-reset-proof");
    for (const [dependency, filename] of [["react", "react.development.js"], ["react-dom", "react-dom.development.js"]]) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(appRequire.resolve(dependency)), "umd", filename), "utf8") });
    }
    await page.evaluate((sources: string[]) => {
      const win = window as any;
      win.calls = []; win.renders = []; win.failLogin = false;
      const widgets = new Map<string, any>();
      win.turnstile = {
        render: (element: HTMLElement, options: any) => {
          const id = `captcha_${win.renders.length}`;
          win.renders.push({ id, action: options.action, size: options.size }); widgets.set(id, options);
          element.textContent = "Verificação de segurança";
          element.innerHTML = `<div style="width:${options.size === "compact" ? "150px;height:140px" : "100%;min-width:300px;height:65px"};border:1px solid #ccc;box-sizing:border-box;padding:12px">Verificação de segurança</div>`;
          return id;
        },
        remove: (id: string) => { widgets.delete(id); },
      };
      win.solve = (token: string) => [...widgets.values()].at(-1)?.callback(token);
      win.expire = () => [...widgets.values()].at(-1)?.["expired-callback"]();
      win.fetch = async (url: string, init?: RequestInit) => {
        if (url.includes("viacep")) return Response.json({ logradouro: "Rua Teste", bairro: "Centro", localidade: "São Paulo", uf: "SP" });
        const body = JSON.parse(String(init?.body ?? "{}"));
        win.calls.push({ url, body });
        if (url.endsWith("/email/login/verify") && win.failLogin) return Response.json({ code: "otp_invalid" }, { status: 400 });
        if (url.endsWith("/email/verify")) return Response.json({ verificationToken: "verified-email" });
        return Response.json({ globalUserId: "user_a", accessToken: "local-buyer-token", email: "buyer@example.test" });
      };
      const modules = sources.map(() => ({ exports: {} as any }));
      const dependencies = (name: string): any => {
        if (name === "react") return win.React;
        if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
        if (name === "@zyon/checkout-ui" || name.endsWith("Turnstile.js")) return modules[0].exports;
        if (name.endsWith("OtpInput")) return { OtpInput: (props: any) => win.React.createElement("input", { "aria-label": props.label ?? "Código de verificação", value: props.value, onChange: (event: any) => props.onChange(event.target.value) }) };
        if (name.endsWith("conversation-access")) return { conversationFetch: win.fetch };
        if (name.endsWith("SignupExperience.js")) return { AuthExperience: (props: any) => props.children };
        if (name.endsWith("SignupWizard.js")) return modules[4].exports;
        if (name.endsWith("masks.js")) return modules[5].exports;
        if (name.endsWith("signup-options.js")) return modules[6].exports;
        if (name.endsWith("SegmentSelect.js")) return { SegmentSelect: () => null };
        if (name.includes("/tabs/")) return new Proxy({}, { get: () => () => null });
        if (name.endsWith("BuyerBiometricAccess")) return { BuyerBiometricAccess: () => null };
        if (name.endsWith("BuyerRegistrationForm")) return modules[2].exports;
        if (name.endsWith("useBuyerHub")) return { useBuyerHub: () => ({}) };
        if (name.endsWith("cart-store")) return { useCart: () => ({ cart: { items: [] } }) };
        if (name.endsWith("buyer-auth")) return { getValidBuyer: () => null };
        if (name.endsWith("useApi.js")) return { useApi: () => ({
          forgotPassword: async (email: string, token: string) => win.calls.push({ url: "forgot-password", body: { email, turnstile_token: token } }),
          resetPassword: async (token: string, password: string, captcha: string) => win.calls.push({ url: "reset-password", body: { token, password, turnstile_token: captcha } }),
        }) };
        if (name.endsWith("read-error.js")) return { readError: (error: any) => error.message };
        if (name.endsWith("auth-error.js")) return { friendlyAuthError: (error: any) => error.message };
        if (name.endsWith("api-client.js")) return { DashboardHttpError: class extends Error {} };
        if (name.endsWith(".css")) return {};
        throw new Error(`Unexpected module ${name}`);
      };
      sources.forEach((source, index) => new Function("require", "module", "exports", "process", source)(dependencies, modules[index], modules[index].exports, { env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "local-site-key" } }));
      let reactRoot: any;
      win.mount = (view: string) => {
        reactRoot?.unmount();
        win.calls = [];
        reactRoot = win.ReactDOM.createRoot(document.getElementById("root"));
        if (view === "buyer-hub-login") {
          reactRoot.render(win.React.createElement(modules[7].exports.EmailLoginForm, { merchantId: "m_a", onAuthSuccess: () => undefined, onAccountNotFound: () => undefined }));
          return;
        }
        if (view === "buyer-login" || view === "buyer-signup") {
          const Component = modules[view === "buyer-login" ? 1 : 2].exports.default;
          reactRoot.render(win.React.createElement(Component, { merchantId: "m_a", onComplete: async () => undefined, onAccountNotFound: () => undefined }));
          return;
        }
        function DashboardProbe() {
          const [captchaToken, setCaptchaToken] = win.React.useState(null);
          const [email, setEmail] = win.React.useState("merchant@example.test");
          const [password, setPassword] = win.React.useState("StrongPassword123!");
          return win.React.createElement(modules[3].exports.AuthScreen, { mode: view, setMode: () => undefined, busy: false, hint: null, email, setEmail, password, setPassword,
            merchantName: "Loja", setMerchantName: () => undefined, turnstileSiteKey: "local-site-key", captchaToken, setCaptchaToken,
            onSubmit: (event: Event) => { event.preventDefault(); win.calls.push({ url: "dashboard-login", body: { turnstile_token: captchaToken } }); },
            onRegister: async (body: any) => { win.calls.push({ url: "dashboard-signup", body }); if (win.failDashboardSignup) throw Error("registration_failed"); }, onSaveTheme: async () => undefined, onComplete: async () => undefined,
          });
        }
        reactRoot.render(win.React.createElement(DashboardProbe));
      };
    }, sources);

    await page.evaluate(() => (window as any).mount("buyer-login"));
    await page.getByPlaceholder("voce@email.com").fill("buyer@example.test");
    assert.equal(await page.getByRole("button", { name: "Confirmar", exact: true }).isDisabled(), true);
    await page.evaluate(() => (window as any).solve("login-send-token"));
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByLabel("Código de verificação", { exact: true }).fill("123456");
    assert.equal(await page.getByRole("button", { name: "Confirmar", exact: true }).isDisabled(), true);
    await page.evaluate(() => { (window as any).failLogin = true; (window as any).solve("login-verify-token"); });
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.waitForFunction(() => (window as any).calls.length === 2);
    assert.equal(await page.getByRole("button", { name: "Confirmar", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => (window as any).calls.map((call: any) => call.body.turnstile_token)), ["login-send-token", "login-verify-token"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const artifact = path.join(root, "test-results/captcha-login-mobile.png");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    await page.screenshot({ path: artifact, fullPage: true });

    await page.evaluate(() => (window as any).mount("buyer-signup"));
    await page.getByLabel("E-mail", { exact: true }).fill("buyer@example.test");
    await page.evaluate(() => (window as any).solve("signup-send-token"));
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByLabel("Código enviado para seu e-mail", { exact: true }).fill("123456");
    await page.evaluate(() => (window as any).solve("signup-verify-token"));
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByLabel("Celular para contato", { exact: true }).fill("11999999999");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByLabel("Nome completo", { exact: true }).fill("Cliente Teste");
    await page.getByLabel("CPF", { exact: true }).fill("52998224725");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.getByLabel("CEP", { exact: true }).fill("01001000");
    await page.getByLabel("Número", { exact: true }).fill("123");
    await page.waitForFunction(() => document.body.textContent?.includes("Rua Teste"));
    const signupButton = page.locator('button[data-neu="primary"]');
    assert.equal(await signupButton.isDisabled(), true);
    await page.evaluate(() => (window as any).solve("signup-register-token"));
    await signupButton.click();
    await page.waitForFunction(() => (window as any).calls.some((call: any) => call.url.endsWith("/buyer/register")));
    assert.deepEqual(await page.evaluate(() => (window as any).calls.filter((call: any) => call.url.includes("/buyer/")).map((call: any) => call.body.turnstile_token)), ["signup-send-token", "signup-verify-token", "signup-register-token"]);

    for (const mode of ["login", "forgot", "reset"]) {
      await page.evaluate((mode: string) => (window as any).mount(mode), mode);
      const submit = page.locator('button[type="submit"]');
      if (mode === "forgot") await page.getByLabel("E-mail", { exact: true }).fill("merchant@example.test");
      if (mode === "reset") {
        await page.getByLabel("Nova senha", { exact: true }).fill("StrongPassword123!");
        await page.getByLabel("Confirmar senha", { exact: true }).fill("StrongPassword123!");
      }
      assert.equal(await submit.isDisabled(), true);
      await page.evaluate(() => { (window as any).solve("expired-token"); (window as any).expire(); });
      assert.equal(await submit.isDisabled(), true);
      await page.getByRole("button", { name: "Tentar verificação novamente" }).click();
      await page.evaluate((token: string) => (window as any).solve(token), `${mode}-fresh-token`);
      await submit.click();
      const url = mode === "login" ? "dashboard-login" : `${mode}-password`;
      await page.waitForFunction((url: string) => (window as any).calls.filter((call: any) => call.url === url).length === 1, url);
      assert.equal(await page.evaluate((url: string) => (window as any).calls.find((call: any) => call.url === url).body.turnstile_token, url), `${mode}-fresh-token`);
    }

    await page.evaluate(() => { (window as any).failDashboardSignup = true; (window as any).mount("signup"); });
    await page.getByLabel("Nome completo", { exact: true }).fill("Lojista Teste");
    await page.getByLabel("Cargo / papel na empresa", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("Nome da loja", { exact: true }).fill("Loja Teste");
    await page.getByLabel("CPF ou CNPJ", { exact: true }).fill("52998224725");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByLabel("E-mail corporativo", { exact: true }).fill("merchant@example.test");
    await page.getByLabel("Senha", { exact: true }).fill("StrongPassword123!");
    await page.getByLabel("Confirmar senha", { exact: true }).fill("StrongPassword123!");
    await page.getByLabel("Celular", { exact: true }).fill("11999999999");
    const createAccount = page.getByRole("button", { name: "Criar conta", exact: true });
    assert.equal(await createAccount.isDisabled(), true);
    await page.evaluate(() => (window as any).solve("dashboard-signup-first-token"));
    await createAccount.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await createAccount.isDisabled(), true);
    await page.evaluate(() => { (window as any).failDashboardSignup = false; (window as any).solve("dashboard-signup-retry-token"); });
    await createAccount.click();
    await page.waitForFunction(() => (window as any).calls.filter((call: any) => call.url === "dashboard-signup").length === 2);
    assert.deepEqual(await page.evaluate(() => (window as any).calls.filter((call: any) => call.url === "dashboard-signup").map((call: any) => call.body.turnstile_token)), ["dashboard-signup-first-token", "dashboard-signup-retry-token"]);

    await page.evaluate(() => { (window as any).failLogin = true; (window as any).mount("buyer-hub-login"); });
    await page.getByPlaceholder("voce@email.com").fill("buyer@example.test");
    const sendCode = page.getByRole("button", { name: "Enviar código por e-mail", exact: true });
    assert.equal(await sendCode.isDisabled(), true);
    await page.evaluate(() => (window as any).solve("hub-send-token"));
    await sendCode.click();
    await page.locator('input[inputmode="numeric"]').fill("123456");
    const confirmCode = page.getByRole("button", { name: "Confirmar código", exact: true });
    assert.equal(await confirmCode.isDisabled(), true);
    await page.evaluate(() => (window as any).solve("hub-login-token"));
    await confirmCode.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await confirmCode.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => (window as any).calls.filter((call: any) => call.url.includes("/buyer/")).map((call: any) => call.body.turnstile_token)), ["hub-send-token", "hub-login-token"]);

    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => (window as any).mount("buyer-login"));
    await page.waitForFunction(() => (window as any).renders.at(-1).size === "compact");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => (window as any).renders.at(-1).size === "flexible");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await browser.close(); }
});
