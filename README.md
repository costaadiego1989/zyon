# AI Checkout Sales Agent MVP

Monorepo TypeScript for an end-to-end MVP: NestJS API, React widget, React merchant dashboard, deterministic offer engines, Shopify adapter, and OpenAI Responses API orchestration.

## Apps

- `apps/api`: NestJS API for checkout sessions, events, decisions, chat, offers, Shopify, and dashboard data.
- `apps/widget`: embeddable React/Web Component checkout agent.
- `apps/dashboard`: merchant dashboard for rules and conversion analytics.

## Packages

- `@aacp/shared-types`: API contracts and domain types.
- `@aacp/rules-engine`: deterministic commercial rule evaluation.
- `@aacp/shipping-engine`: shipping offer evaluator.
- `@aacp/decision-engine`: abandonment and intervention logic.
- `@aacp/conversation-engine`: LLM prompt/orchestration with safe fallback.
- `@aacp/commerce-adapters`: Shopify discount-code adapter.

## Run

```bash
pnpm install
cp .env.example .env
pnpm dev:api
pnpm dev:widget
pnpm dev:dashboard
```

The API uses an in-memory repository for the MVP so the full flow runs immediately. PostgreSQL is the intended persistence target for the next hardening pass.

## AI conversation provider (DeepSeek / OpenAI)

The conversational agent in the widget calls a real LLM through `@aacp/conversation-engine`. Configure one of these in `.env` (or `apps/api/.env`):

- `DEEPSEEK_API_KEY` (preferred) — uses `deepseek-chat` at `https://api.deepseek.com/v1`. Override with `DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL` if needed.
- `OPENAI_API_KEY` — fallback, uses the OpenAI Responses API.

`apps/api/src/main.ts` loads `apps/api/.env` first, then the repo-root `.env`, and logs which AI keys were detected on boot. Without a key, `SendChatMessageUseCase` falls back to a deterministic safe reply — fine for smoke tests but not for production.

To run the live AI checkout journey tests against a real LLM:

```bash
# in apps/api/.env
DEEPSEEK_API_KEY=sk-deepseek-...
RUN_REAL_AI_E2E=true

pnpm --filter @aacp/api test
```

The two live scenarios (`checkout.ai-live-e2e-spec.ts`) cover a single objection turn and a full multi-turn purchase journey (start → shipping objection → coupon ask → apply offer → complete order), and assert that the AI replies are non-deterministic and that the persisted `chatHistory` grows correctly.

## B2B theme customization

Each merchant can theme the conversational widget — accent colour, text/background colour, font, logo and agent avatar — via the dashboard:

```http
PUT /merchants/me/theme
{
  "accentColor": "#FF0066",
  "textColor": "#0F172A",
  "backgroundColor": "#F9FAFB",
  "fontFamily": "Manrope, system-ui, sans-serif",
  "logoUrl": "https://cdn.loja.com/logo.png"
}
```

The theme is returned inside `StartCheckoutResponse.experience.brand.theme` and the widget injects it as CSS custom properties (`--aacp-accent`, `--aacp-fg`, `--aacp-bg`, `--aacp-font`). See [`docs/integrations/checkout-widget-and-api.md`](docs/integrations/checkout-widget-and-api.md) for the full theme contract and validation rules.

## Premium widget surfaces

The buyer-facing widget is intentionally not a dashboard. The public surface now follows the Lovable checkout baseline: dark premium shell, mobile-first chat, icon stepper, quick replies, fixed composer and a Stripe-like cart with item removal, totals and payment CTA. Internal telemetry, rule-engine labels and conversion metrics are not rendered to the buyer.

After global login, the same widget can open an authenticated account hub with order history, account metrics, user/merchant configuration and agent configuration. See [`docs/product/premium-widget-ui-system.md`](docs/product/premium-widget-ui-system.md) and [`docs/product/agentic-checkout-differentiation.md`](docs/product/agentic-checkout-differentiation.md).

The widget implementation is split as MVVM: `main.tsx` handles the Web Component bootstrap, `useCheckoutAgentViewModel` owns state/API actions, and checkout components render the public experience. Phone login is the target UX; Google remains visually present but disabled until buyer OAuth is implemented.

## Database (PostgreSQL)

Local development uses Docker Compose (`docker-compose.yml`): Postgres 16 on host port **55432**, database `aacp_test`, user/password `postgres`/`postgres`.

```bash
pnpm db:up        # requires Docker Desktop running on Windows
pnpm db:migrate
pnpm test:prisma  # integration + Prisma e2e (needs DB)
```

### Windows: `dockerDesktopLinuxEngine` / pipe not found

That error means the **Docker engine is not running** (not a broken `postgres:16-alpine` image). Open **Docker Desktop**, wait until it says it is running, then run `docker info` — it must succeed. After that, `pnpm db:up` should pull the image and start the container.

If you do not use Docker: install PostgreSQL locally, create database `aacp_test`, set `DATABASE_URL` in `.env` and `apps/api/.env` to match, then `pnpm db:migrate`.

### Desktop says "running" but `docker ps` fails everywhere (incl. PowerShell)

Typical causes on Windows:

1. **Daemon not fully up** — quit Docker Desktop from the tray (Quit Docker Desktop), wait 10s, open it again and wait until **Engine running** (not only "Starting").
2. **WSL 2 backend** — Settings → General → confirm **Use WSL 2 backend** matches your setup; Resources → **WSL integration** → enable your distro. Run `wsl --update` then reboot if WSL was never updated.
3. **Broken named pipe** — after a crash, the pipe `dockerDesktopLinuxEngine` may be missing until a full Desktop restart or **Troubleshoot → Restart** in Docker Desktop.
4. **`docker context`** — run `docker context ls`. Active should be **`desktop-linux`** with endpoint `dockerDesktopLinuxEngine`. If you switched contexts, run `docker context use desktop-linux`.
5. **Git Bash quirks** — if `docker` is "not found" only in Git Bash: use **PowerShell** or **CMD** first, or add `C:\Program Files\Docker\Docker\resources\bin` to Bash `PATH`. For path quirks: `MSYS_NO_PATHCONV=1 docker ps` rarely fixes pipes; Connection errors are usually the engine, not MSYS.

**Sanity check:** `docker version` must show **Server** section too. If you only see **Client**, the daemon is unreachable — fix Desktop/WSL before `pnpm db:up`.

Optional **reset** (last resort): Docker Desktop → Troubleshoot → **Reset to factory defaults** (removes volumes/images).

## Widget Enterprise Conectado à API

O demo do widget (`apps/widget/index.html`) não depende mais de carrinho fixo no código React. O host da loja envia `data-cart-json`, `data-customer-json` e `data-shipping-json`; o widget repassa isso para a API em `/checkout/start` ou `/embed/start`, e a API devolve `experience` com marca, resumo do pedido, copy inicial e sugestões.

Smoke test local sem Docker:

1. Configure `DATABASE_URL` apontando para um Postgres local se quiser repositórios Prisma. Para fluxo em memória, mantenha `CHECKOUT_REPOSITORY` sem `prisma`.
2. Rode `pnpm dev:api`.
3. Em outro terminal, rode `pnpm dev:widget`.
4. Abra `http://localhost:5173`.
5. Confirme que o painel mostra a marca `Northstar Atelier`, o item `Bolsa Executiva Couro Safiano`, total com frete e mensagem inicial retornada pela API.

Integrações de clientes podem escolher entre dois modelos: **Embed UI**, com a interface enterprise da AACP instalada por script/Web Component, ou **API-only**, em que a loja mantém sua própria UI e consome nossas rotas de sessão, chat, eventos, ofertas e pagamento. Consulte `docs/integrations/checkout-widget-and-api.md` para snippets, payloads e requisitos de segurança.

Para alinhar posicionamento e UI, leia também:

- `docs/product/agentic-checkout-differentiation.md`
- `docs/product/premium-widget-ui-system.md`
