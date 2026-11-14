/**
 * Stable selectors for dashboard E2E tests.
 * Prefer data-testid > role > placeholder > text content.
 *
 * When adding data-testid to components, follow the pattern:
 *   data-testid="[module]-[element]-[qualifier]"
 *   e.g., "orders-table-row", "auth-submit-btn", "nav-logout-btn"
 */

/* ── Auth selectors ─────────────────────────────────────────────── */

export const AUTH = {
  emailInput: "input[type='email']",
  passwordInput: "input[type='password']",
  submitBtn: "button[type='submit']",
  errorHint: ".auth-hint",
  loginTab: "[role='tab']:has-text('Entrar')",
  signupTab: "[role='tab']:has-text('Criar conta')",
  forgotLink: "button:has-text('Esqueceu?')",
  showPasswordBtn: "[aria-label='Mostrar senha'], [aria-label='Ocultar senha']",
} as const;

/* ── Shell/Layout selectors ─────────────────────────────────────── */

export const SHELL = {
  nav: "nav",
  logo: "img[alt='Zyon']",
  logoutBtn: "[data-testid='logout-btn'], button:has-text('Sair')",
  userMenu: "[data-testid='user-menu']",
} as const;

/* ── Table selectors (generic) ──────────────────────────────────── */

export const TABLE = {
  root: "table",
  head: "thead",
  body: "tbody",
  row: "tbody tr",
  header: "th",
  cell: "td",
  search: "input[placeholder*='Buscar']",
} as const;

/* ── Overview selectors ─────────────────────────────────────────── */

export const OVERVIEW = {
  revenueCard: "text=RECEITA GERADA · 7 DIAS",
  sessionsMetric: "text=SESSÕES",
  conversionMetric: "text=CONVERSÃO",
  ticketMetric: "text=TICKET MÉDIO",
  agentBadge: "text=Agente operante, text=Agente indisponível",
} as const;

/* ── Buttons/Actions ────────────────────────────────────────────── */

export const ACTIONS = {
  export: "button:has-text('Exportar'), [data-testid='export-btn']",
  filter: "button:has-text('Filtrar'), [data-testid='filter-btn']",
  save: "button:has-text('Salvar'), button[type='submit']",
  cancel: "button:has-text('Cancelar'), [data-testid='cancel-btn']",
  copy: "button:has-text('Copiar'), [data-testid='copy-btn']",
} as const;
