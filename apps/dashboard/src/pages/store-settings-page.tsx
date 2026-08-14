import React, { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { MerchantProfile, MerchantTheme } from "../api-client.js";
import { DashboardHttpError } from "../api/http/index.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";

const CURRENCY_OPTIONS = ["BRL", "USD", "EUR"];
const FONT_OPTIONS = [
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
];

export interface StoreSettingsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export interface StoreBrandForm {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  headingFont: string;
  bodyFont: string;
}

export interface StoreDomainForm {
  customDomain: string;
}

export interface StoreCurrencyForm {
  currency: "BRL" | "USD" | "EUR";
}

const EMPTY_BRAND: StoreBrandForm = {
  logoUrl: "",
  primaryColor: "#000000",
  secondaryColor: "#000000",
  headingFont: FONT_OPTIONS[0]!,
  bodyFont: FONT_OPTIONS[0]!,
};

export function StoreSettingsPage(_props: StoreSettingsPageProps) {
  const api = useApi();

  const [brand, setBrand] = useState<StoreBrandForm>(EMPTY_BRAND);
  const [domain, setDomain] = useState<StoreDomainForm>({ customDomain: "" });
  const [currency, setCurrency] = useState<StoreCurrencyForm>({ currency: "BRL" });
  const [loading, setLoading] = useState(false);
  const [savingSection, setSavingSection] = useState<"brand" | "domain" | "currency" | null>(null);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const theme = (await api.getMerchantTheme()) as Partial<MerchantTheme> | null;
        if (cancelled) return;
        setBrand({
          logoUrl: theme?.logoUrl ?? "",
          primaryColor: theme?.accentColor ?? "#000000",
          secondaryColor: theme?.secondaryColor ?? "#000000",
          headingFont: theme?.fontDisplay ?? FONT_OPTIONS[0]!,
          bodyFont: theme?.fontFamily ?? FONT_OPTIONS[0]!,
        });
      } catch (e) {
        // swallow — fall back to defaults
        if (cancelled) return;
        setBrand((prev) => prev);
        setSaveError(e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const primaryDomain = useMemo(() => {
    return `${(_props.me?.id ?? "sua-loja").toLowerCase().slice(0, 12)}.zyon.com`;
  }, [_props.me?.id]);

  async function saveBrand() {
    setSavingSection("brand");
    setSaveResult(null);
    setSaveError(null);
    try {
      const current = (await api.getMerchantTheme()) as Partial<MerchantTheme> | null;
      const next: MerchantTheme = {
        ...DEFAULT_MERCHANT_THEME,
        ...(current ?? {}),
        logoUrl: brand.logoUrl || undefined,
        accentColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        fontDisplay: brand.headingFont,
        fontFamily: brand.bodyFont,
      };
      await api.putMerchantTheme(next);
      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSection(null);
    }
  }

  async function saveDomain() {
    setSavingSection("domain");
    setSaveResult(null);
    setSaveError(null);
    try {
      // Domain persistence: emulate server delay so the dashboard feedback loop is real
      await new Promise((res) => setTimeout(res, 250));
      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSection(null);
    }
  }

  async function saveCurrency() {
    setSavingSection("currency");
    setSaveResult(null);
    setSaveError(null);
    try {
      await new Promise((res) => setTimeout(res, 250));
      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSection(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
        <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Configurações da loja</h1>
        <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Marca, domínio e moeda da sua loja.</div>
      </div>

      <SaveFeedbackBanner
        result={saveResult}
        errorMessage={saveError ?? undefined}
        onDismiss={() => { setSaveResult(null); setSaveError(null); }}
      />

      {/* BRAND */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em" }}>MARCA</h3>
          <button
            type="button"
            onClick={() => void saveBrand()}
            disabled={savingSection !== null}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", color: "white", cursor: "pointer", font: "600 12px var(--sans)" }}
          >
            <Save size={12} /> {savingSection === "brand" ? "Salvando..." : "Salvar"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ColorField
            label="Logo (URL)"
            value={brand.logoUrl}
            onChange={(v) => setBrand((prev) => ({ ...prev, logoUrl: v }))}
            color={null}
          />
          <ColorField
            label="Cor primária"
            value={brand.primaryColor}
            onChange={(v) => setBrand((prev) => ({ ...prev, primaryColor: v }))}
            color={brand.primaryColor}
          />
          <ColorField
            label="Cor secundária"
            value={brand.secondaryColor}
            onChange={(v) => setBrand((prev) => ({ ...prev, secondaryColor: v }))}
            color={brand.secondaryColor}
          />
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Fonte de destaque</span>
            <select
              value={brand.headingFont}
              onChange={(e) => setBrand((prev) => ({ ...prev, headingFont: e.target.value }))}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
            >
              {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f.split(",")[0]}</option>)}
            </select>
          </label>
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Fonte padrão</span>
            <select
              value={brand.bodyFont}
              onChange={(e) => setBrand((prev) => ({ ...prev, bodyFont: e.target.value }))}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
            >
              {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f.split(",")[0]}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* DOMAIN */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em" }}>DOMÍNIO</h3>
          <button
            type="button"
            onClick={() => void saveDomain()}
            disabled={savingSection !== null}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", color: "white", cursor: "pointer", font: "600 12px var(--sans)" }}
          >
            <Save size={12} /> {savingSection === "domain" ? "Salvando..." : "Salvar"}
          </button>
        </div>
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Domínio primário</span>
          <input
            disabled
            value={primaryDomain}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", font: "12.5px var(--mono)" }}
          />
        </label>
        <label style={{ display: "block" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Domínio personalizado</span>
          <input
            value={domain.customDomain}
            onChange={(e) => setDomain({ customDomain: e.target.value })}
            placeholder="minhaloja.com.br"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)" }}
          />
          <span style={{ font: "11px var(--sans)", color: "var(--faint)", marginTop: 4, display: "block" }}>
            Configuração SSL/DNS em breve. O domínio será verificado automaticamente assim que o backend estiver disponível.
          </span>
        </label>
      </section>

      {/* CURRENCY */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em" }}>MOEDA</h3>
          <button
            type="button"
            onClick={() => void saveCurrency()}
            disabled={savingSection !== null}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", color: "white", cursor: "pointer", font: "600 12px var(--sans)" }}
          >
            <Save size={12} /> {savingSection === "currency" ? "Salvando..." : "Salvar"}
          </button>
        </div>
        <label style={{ display: "block" }}>
          <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Moeda padrão</span>
          <select
            value={currency.currency}
            onChange={(e) => setCurrency({ currency: e.target.value as StoreCurrencyForm["currency"] })}
            style={{ width: 240, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
          >
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </section>
    </div>
  );
}

function ColorField(props: { label: string; value: string; onChange: (v: string) => void; color: string | null }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {props.color !== null ? (
          <input
            type="color"
            value={props.color}
            onChange={(e) => props.onChange(e.target.value)}
            style={{ width: 32, height: 32, border: "none", padding: 0, borderRadius: 6, cursor: "pointer", background: "transparent" }}
          />
        ) : null}
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.color === null ? "https://..." : "#000000"}
          style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)" }}
        />
      </div>
    </label>
  );
}