import "./theme-page/theme-page.css";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { PageHeader } from "../components/PageHeader.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save, X, Type, Shield, Palette, Image, Layout } from "lucide-react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile } from "../api-client.js";
import { ThemePreviewCard } from "./theme-page/components/ThemePreviewCard.js";
import { ImageUploader } from "../components/ImageUploader.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { showToast } from "../components/Toast.js";
import { Button } from "../components/Button.js";
import { FormField, FormSelect } from "../components/FormField.js";
import { reportError } from "../lib/observability/error-reporter.js";
import { applyThemeMode, normalizeThemeDraft } from "./theme-page/theme-preview-palette.js";
import { changedFields } from "../lib/config-patch.js";

// ── Exported Constants & Helpers (testable) ──────────────────────────────────

export const LABELS = {
  loginRequired: "Login necessário.",
  tenantSubtitle: "Personalize a aparência do checkout para combinar com sua marca.",
  headerTitle: "Nome da loja",
  headerSubtitle: "Subtítulo da loja",
  badges: "Selos de confiança",
  fontUi: "Tipografia da interface",
  fontDisplay: "Tipografia de destaque",
  borderRadius: "Arredondamento",
  assetsLayout: "Imagens e layout",
  reset: "Restaurar padrão",
  saveSuccess: "Tema salvo com sucesso.",
  resetConfirm: "Restaurar o tema padrão? Suas alterações não salvas serão perdidas.",
  urlInvalid: "Use um endereço válido, começando com https://",
  unsavedChanges: "Alterações não salvas",
  badgesMax: "máximo 4",
  addBadge: "Adicionar",
} as const;

export const COLOR_FIELDS: Array<{ key: keyof MerchantTheme; label: string }> = [
  { key: "accentColor", label: "Cor principal: botões e destaques" },
  { key: "secondaryColor", label: "Cor secundária: elementos de apoio" },
  { key: "textColor", label: "Texto principal" },
  { key: "mutedTextColor", label: "Texto discreto" },
  { key: "backgroundColor", label: "Fundo da página" },
  { key: "surfaceColor", label: "Fundo de cartões" },
  { key: "surfaceElevatedColor", label: "Fundo de modais" },
  { key: "borderColor", label: "Bordas e separadores" },
  { key: "successColor", label: "Sucesso e confirmações" },
  { key: "warningColor", label: "Alertas e avisos" },
];

export const DENSITY_OPTIONS: Array<{ value: NonNullable<MerchantTheme["density"]>; label: string; desc: string }> = [
  { value: "compact", label: "Estreito", desc: "Checkout estreito, ideal para uma coluna lateral" },
  { value: "comfortable", label: "Médio", desc: "Tamanho padrão equilibrado" },
  { value: "spacious", label: "Amplo", desc: "Ocupa toda largura disponível" },
];

export function isValidUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseBadges(text: string): string[] {
  return text
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function canAddBadge(badgesText: string): boolean {
  return parseBadges(badgesText).length < 4;
}

export function computeDirty(
  currentTheme: MerchantTheme,
  currentBadges: string,
  initialTheme: MerchantTheme,
  initialBadges: string
): boolean {
  const currentNormalized = { ...currentTheme, trustBadges: parseBadges(currentBadges) };
  const initialNormalized = { ...initialTheme, trustBadges: parseBadges(initialBadges) };
  return JSON.stringify(currentNormalized) !== JSON.stringify(initialNormalized);
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
  "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
  "Nunito, Inter, ui-sans-serif, system-ui, sans-serif",
  "Poppins, Inter, ui-sans-serif, system-ui, sans-serif",
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
  "Geist, Inter, ui-sans-serif, system-ui, sans-serif",
  "Montserrat, Inter, ui-sans-serif, system-ui, sans-serif",
];

function handleImageUpload(
  file: File,
  onResult: (dataUrl: string) => void
): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      onResult(reader.result);
    }
  };
  reader.readAsDataURL(file);
}

function mergeTheme(theme?: Partial<MerchantTheme> | null): MerchantTheme {
  return normalizeThemeDraft(theme);
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThemePage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [theme, setTheme] = useState<MerchantTheme>(mergeTheme());
  const [badgesText, setBadgesText] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));
  const [badgeInput, setBadgeInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [initialTheme, setInitialTheme] = useState<MerchantTheme>(mergeTheme());
  const [initialBadges, setInitialBadges] = useState((DEFAULT_MERCHANT_THEME.trustBadges ?? []).join(", "));

  const dirty = useMemo(
    () => computeDirty(theme, badgesText, initialTheme, initialBadges),
    [theme, badgesText, initialTheme, initialBadges]
  );

  const invalidColors = COLOR_FIELDS.filter(field => !/^#[0-9a-f]{6}$/i.test(String(theme[field.key] ?? "")));

  // ── Load theme ──
  useEffect(() => {
    let active = true;
    async function load() {
      if (!props.me) {
        setTheme(mergeTheme());
        setLoaded(true);
        return;
      }
      setBusy(true); setLoadError(null);
      try {
        const [savedTheme, agent] = await Promise.all([api.getMerchantTheme(), api.getAgentRules()]);
        const identity = agent.identity as { agentName?: string } | undefined;
        const next = mergeTheme({ ...savedTheme, agentName: identity?.agentName ?? savedTheme.agentName });
        if (!active) return;
        setTheme(next);
        const badges = (next.trustBadges ?? []).join(", ");
        setBadgesText(badges);
        setInitialTheme(next);
        setInitialBadges(badges);
      } catch (e) {
        reportError({ source: "theme-page-load", error: e });
        const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
        if (active) setLoadError("Não foi possível carregar a aparência salva. Tente novamente antes de editar.");
      } finally {
        if (active) { setBusy(false); setLoaded(true); }
      }
    }
    void load();
    return () => { active = false; };
  }, [api, props.me, reload]);

  // Preview updates reactively via ThemeInlinePreview props

  // ── beforeunload guard ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function patch(patchValue: Partial<MerchantTheme>) {
    setTheme((current) => ({ ...current, ...patchValue }));
  }

  function normalizedTheme(): MerchantTheme {
    return {
      ...theme,
      trustBadges: parseBadges(badgesText),
    };
  }

  async function save() {
    if (saving.current || !loaded || loadError || !dirty || invalidColors.length) return;
    saving.current = true; setSaveError(null);
    setBusy(true);
    try {
      const payload = changedFields(normalizedTheme(), {
        ...initialTheme,
        trustBadges: parseBadges(initialBadges),
      });
      // Identity belongs to Agente IA, even when resetting the appearance.
      delete payload.agentName;
      // Upload only edited image fields; unrelated appearance values stay intact.
      const imageFields = ["logoUrl", "faviconUrl", "agentAvatarUrl", "backgroundImageUrl"] as const;
      for (const field of imageFields) {
        const value = payload[field];
        if (typeof value === "string" && value.startsWith("data:")) {
          try {
            const { logoUrl } = await api.uploadLogo(value);
            payload[field] = logoUrl;
          } catch (e) {
            reportError({ source: `theme-page-${field}-upload`, error: e });
            // S3 failed — save inline as fallback (keeps the data URI).
          }
        }
      }
      const saved = mergeTheme({ ...await api.putMerchantTheme(payload), agentName: theme.agentName });
      setTheme(saved);
      const badges = (saved.trustBadges ?? []).join(", ");
      setBadgesText(badges);
      setInitialTheme(saved);
      setInitialBadges(badges);
      showToast("success", LABELS.saveSuccess);
    } catch (e) {
      reportError({ source: "theme-page-save", error: e });
      const text = e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e);
      setSaveError("Não foi possível salvar a aparência. Suas alterações foram preservadas para você tentar novamente.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function reset() {
    setConfirmReset(false); setSaveError(null);
    const next = mergeTheme({ agentName: initialTheme.agentName });
    setTheme(next);
    setBadgesText((next.trustBadges ?? []).join(", "));
  }

  function addBadge() {
    const trimmed = badgeInput.trim();
    if (!trimmed || trimmed.length > 40 || !canAddBadge(badgesText)) return;
    const current = parseBadges(badgesText);
    current.push(trimmed);
    setBadgesText(current.join(", "));
    setBadgeInput("");
  }

  function removeBadge(index: number) {
    const current = parseBadges(badgesText);
    current.splice(index, 1);
    setBadgesText(current.join(", "));
  }

  // ── Login required state ──
  if (!props.me) {
    return (
      <>
        <PageHeader title="Aparência do checkout" description="Personalize a identidade visual do checkout e confira as alterações na prévia." />
      </>
    );
  }

  return (
    <div className="page-container theme-page">
      <PageHeader title="Aparência do checkout" description="Personalize a identidade visual do checkout e confira as alterações na prévia." actions={<>
<div className="button-row">
          {dirty && <span className="badge warn">Alterações não salvas</span>}
          <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={busy || Boolean(loadError)}>
            <RotateCcw size={14} style={{ marginRight: 6 }} /> Restaurar padrão
          </Button>
          <Button variant="primary" arrow onClick={() => void save()} disabled={busy || !dirty || Boolean(loadError) || invalidColors.length > 0} loading={busy}>
            <Save size={14} style={{ marginRight: 6 }} /> Salvar
          </Button>
        </div>
</>} />

      <ConfirmDialog open={confirmReset} title="Restaurar aparência padrão?" description="As cores, fontes e imagens da prévia voltarão ao padrão. A loja só será alterada quando você salvar." confirmLabel="Restaurar prévia" variant="default" busy={busy} onConfirm={reset} onCancel={() => setConfirmReset(false)} />
      {saveError && <div className="panel-error" role="alert">{saveError}</div>}
      {loadError ? <EmptyState icon={Palette} title="Aparência indisponível" description={loadError} action={<Button variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>Tentar novamente</Button>} /> : !loaded ? (
        <div className="split-panel" data-testid="theme-skeleton">
          <div className="split-panel-controls">
            <section className="panel stacked skeleton-panel">
              <div className="skeleton-line w-40" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-60" />
            </section>
            <section className="panel stacked skeleton-panel">
              <div className="skeleton-line w-40" />
              <div className="skeleton-line w-full" />
              <div className="skeleton-line w-full" />
            </section>
          </div>
          <div className="split-panel-preview">
            <div className="skeleton-block" style={{ height: 460 }} />
          </div>
        </div>
      ) : (
        <div className="split-panel">
          {/* ── controls column ── */}
          <fieldset className="split-panel-controls theme-page__controls configuration-form" disabled={busy}>

            {/* Panel 1 — Identidade */}
            <div className="panel stacked">
              <SectionHeader title="Identidade e tipografia" variant="secondary" />

              <div className="form-field">
                <label htmlFor="theme-agent-name">Nome do assistente</label>
                <input id="theme-agent-name" value={theme.agentName ?? ""} readOnly />
                <span className="form-field-hint">Altere o nome em Canais → Agente IA. Ele é usado na loja e no checkout.</span>
              </div>

              <div className="theme-grid-2">
                <FormSelect
                  label="Tipografia primária"
                  value={theme.fontFamily}
                  onChange={(v) => patch({ fontFamily: v })}
                  options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0] }))}
                />
                <FormSelect
                  label="Tipografia secundária"
                  value={theme.fontDisplay ?? theme.fontFamily}
                  onChange={(v) => patch({ fontDisplay: v })}
                  options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0] }))}
                />
              </div>

            </div>

            {/* Panel — Selos de confiança */}
            <div className="panel stacked">
              <SectionHeader title="Selos de confiança" subtitle="Adicione até 4 informações curtas sobre a loja. Use apenas condições que você oferece." />

              {parseBadges(badgesText).length > 0 && (
                <div className="chip-list">
                  {parseBadges(badgesText).map((badge, i) => (
                    <span key={`${badge}-${i}`} className="chip">
                      {badge}
                      <button type="button" className="chip-remove" onClick={() => removeBadge(i)} aria-label={`Remover ${badge}`}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="theme-page__badge-entry"><FormField label="Novo selo" value={badgeInput} onChange={setBadgeInput} maxLength={40} disabled={busy || !canAddBadge(badgesText)} placeholder="Ex.: Compra segura" hint="Até 40 caracteres por selo." onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addBadge(); } }} /><Button variant="outline" onClick={addBadge} disabled={!badgeInput.trim() || !canAddBadge(badgesText)}>Adicionar selo</Button></div>
              <span className="field-hint">{parseBadges(badgesText).length}/4 selos</span>
            </div>

            {/* Panel 2 — Cores */}
            <div className="panel stacked">
              <SectionHeader title="Paleta de cores" subtitle="Use códigos hexadecimais de 6 dígitos, como #0F766E. Nos modos escuro e cinza, as cores de fundo e texto seguem a paleta do modo." variant="secondary" />
              <div className="theme-grid-2">
                {COLOR_FIELDS.map((field) => (
                  <div key={String(field.key)} className="theme-color-field">
                    <label className="theme-color-label" htmlFor={"theme-color-" + field.key}>{field.label}</label>
                    <div className="theme-color-input">
                      <input
                        aria-label={"Selecionar " + field.label.toLocaleLowerCase("pt-BR")}
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(String(theme[field.key])) ? String(theme[field.key]) : "#0F766E"}
                        onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                      />
                      <input
                        id={"theme-color-" + field.key}
                        aria-invalid={!/^#[0-9a-f]{6}$/i.test(String(theme[field.key]))}
                        aria-describedby={"theme-color-help-" + field.key}
                        maxLength={7}
                        type="text"
                        value={String(theme[field.key] ?? "")}
                        onChange={(e) => patch({ [field.key]: e.target.value } as Partial<MerchantTheme>)}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      />
                    </div>
                    <span id={"theme-color-help-" + field.key} className="form-field-hint">{!/^#[0-9a-f]{6}$/i.test(String(theme[field.key])) ? "Informe # e 6 dígitos de 0 a 9 ou A a F." : ""}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3 — Imagens */}
            <div className="panel stacked">
              <SectionHeader title="Imagens" subtitle="Logo, favicon, avatar e fundo do widget." />

              <div className="theme-image-uploader-grid">
                <ImageUploader
                  label="Logo da marca"
                  hint="Exibida no topo do widget"
                  value={theme.logoUrl}
                  onChange={(url) => patch({ logoUrl: url })}
                  height={88}
                />

                <ImageUploader
                  label="Favicon"
                  hint="Ícone da aba do navegador (32×32px recomendado)"
                  value={theme.faviconUrl}
                  onChange={(url) => patch({ faviconUrl: url })}
                  height={88}
                />

                <ImageUploader
                  label="Avatar do assistente"
                  hint="Foto do agente na conversa"
                  value={theme.agentAvatarUrl}
                  onChange={(url) => patch({ agentAvatarUrl: url })}
                  height={88}
                />

                <ImageUploader
                  label="Imagem de fundo"
                  hint="Fundo do painel principal"
                  value={theme.backgroundImageUrl}
                  onChange={(url) => patch({ backgroundImageUrl: url })}
                  height={88}
                />
              </div>
            </div>

            {/* Panel 4 — Layout */}
            <div className="panel stacked">
              <SectionHeader title="Layout e espaçamento" variant="secondary" />

              <label className="theme-radius-field">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="theme-radius-label">Arredondamento dos cantos</span>
                  <span className="theme-radius-value">{theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={theme.borderRadius ?? DEFAULT_MERCHANT_THEME.borderRadius}
                  onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
                  style={{ accentColor: "var(--color-brand)", width: "100%" }}
                />
              </label>

              <label>
                Layout do widget
                <br /><span className="field-hint" style={{ marginTop: 4, display: "inline-block" }}>Largura do checkout na página</span>
              </label>
              <div className="filter-tabs">
                {DENSITY_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    aria-pressed={theme.density === opt.value}
                    className={`filter-tab${theme.density === opt.value ? " active" : ""}`}
                    onClick={() => patch({ density: opt.value })}
                    title={opt.desc}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label>
                Modo de cor
                <br /><span className="field-hint" style={{ marginTop: 4, display: "inline-block" }}>Escolha uma base para fundos e textos. A cor da marca, as imagens e as fontes são mantidas.</span>
              </label>
              <div className="filter-tabs">
                {([
                  { value: "dark", label: "Escuro" },
                  { value: "grey", label: "Cinza" },
                  { value: "light", label: "Claro" },
                ] as const).map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    className={`filter-tab${(theme.mode ?? "light") === opt.value ? " active" : ""}`}
                    aria-pressed={(theme.mode ?? "light") === opt.value}
                    onClick={() => setTheme(current => applyThemeMode(current, opt.value))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </fieldset>

          {/* ── Preview — native replica of the storefront intro, updates live ── */}
          <div className="split-panel-preview">
            <ThemePreviewCard theme={{ ...theme, trustBadges: parseBadges(badgesText) }} storeName={props.me?.name ?? "Sua loja"} />
          </div>
        </div>
      )}
    </div>
  );
}

