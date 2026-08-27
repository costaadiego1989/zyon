"use client";

import { useState, useCallback } from "react";
import type { BuyerPreferences, BuyerIntentProfile } from "@/lib/viewmodels/useBuyerHub";

// ─── Shared Types ──────────────────────────────────────────────────────────

export interface PreferencesTabProps {
  preferences: BuyerPreferences | null;
  intentProfile: BuyerIntentProfile | null;
  loading: boolean;
  onUpdatePreference: (key: string, value: boolean | string) => Promise<void>;
}

// ─── Formatters ────────────────────────────────────────────────────────────

const percentFmt = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 0 });

function fmtPercent(value: number | undefined | null): string {
  if (typeof value !== "number") return "—";
  return percentFmt.format(value);
}

// ─── Icons (inline SVG) ────────────────────────────────────────────────────


function IconCheck() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  value: boolean;
  onChange: (v: boolean) => Promise<void>;
  label: string;
  description?: string;
  disabled?: boolean;
}

function ToggleSwitch({ value, onChange, label, description, disabled = false }: ToggleSwitchProps) {
  const [busy, setBusy] = useState(false);

  const handle = useCallback(async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onChange(!value);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, value, onChange]);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 2px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={handle}
          disabled={busy || disabled}
          aria-label={`${label} - ${value ? "ativado" : "desativado"}`}
          aria-pressed={value}
          style={{
            background: "transparent",
            border: "none",
            cursor: busy || disabled ? "not-allowed" : "pointer",
            padding: 0,
            textAlign: "left",
            color: "inherit",
            font: "inherit",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            width: "100%",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--aacp-fg)",
              }}
            >
              {label}
            </div>
            {description && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--aacp-muted)",
                  marginTop: "2px",
                  lineHeight: 1.4,
                }}
              >
                {description}
              </div>
            )}
          </div>
        </button>
      </div>
      <button
        type="button"
        role="switch"
        onClick={handle}
        disabled={busy || disabled}
        aria-label={`${label} - ${value ? "ativar" : "desativar"}`}
        aria-checked={value}
        style={{
          position: "relative",
          display: "inline-block",
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          padding: 0,
          background: value ? "var(--aacp-accent)" : "var(--aacp-surface-3, rgba(255,255,255,0.12))",
          cursor: busy || disabled ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : disabled ? 0.45 : 1,
          transition: "background 200ms ease",
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "2px",
            left: "2px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#ffffff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            transform: value ? "translateX(20px)" : "translateX(0)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
    </div>
  );
}

// ─── Language Select ───────────────────────────────────────────────────────

interface LanguageSelectProps {
  value: string;
  onChange: (v: string) => Promise<void>;
  disabled?: boolean;
}

function LanguageSelect({ value, onChange, disabled = false }: LanguageSelectProps) {
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (busy || disabled) return;
      setBusy(true);
      try {
        await onChange(e.target.value);
      } catch (err) {
        console.error(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, onChange],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label
        htmlFor="language-select"
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--aacp-fg)",
        }}
      >
        Idioma
      </label>
      <select
        id="language-select"
        value={value}
        onChange={handle}
        disabled={busy || disabled}
        style={{
          padding: "10px 12px",
          borderRadius: "8px",
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-3)",
          color: "var(--aacp-fg)",
          fontSize: "13px",
          cursor: busy || disabled ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : disabled ? 0.45 : 1,
          transition: "opacity 200ms ease",
          fontFamily: "inherit",
        }}
      >
        <option value="pt-BR">Português (Brasil)</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}

// ─── Intent Profile Section ────────────────────────────────────────────────

interface IntentProfileSectionProps {
  intentProfile: BuyerIntentProfile | null;
  loading: boolean;
}

function IntentProfileSection({ intentProfile, loading }: IntentProfileSectionProps) {
  if (loading) {
    return (
      <div
        style={{
          padding: "24px 0",
          textAlign: "center",
          color: "var(--aacp-muted)",
          fontSize: "13px",
        }}
      >
        Carregando perfil…
      </div>
    );
  }

  if (!intentProfile?.has_consent) {
    return (
      <div
        style={{
          padding: "16px 14px",
          borderRadius: "8px",
          background: "var(--aacp-surface-2)",
          border: "1px solid var(--aacp-line)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>
          Nenhuma preferência ativa
        </div>
        <div style={{ fontSize: "12px", color: "var(--aacp-muted)", lineHeight: 1.5 }}>
          Aceite personalização no checkout para ativar o perfil de intenção e ver recomendações personalizadas.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {intentProfile.primary_intent && (
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--aacp-muted)",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Intenção principal
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--aacp-surface-2)",
              border: "1px solid var(--aacp-line)",
            }}
          >
            <IconCheck />
            <span style={{ fontSize: "13px", color: "var(--aacp-fg)", fontWeight: 500 }}>
              {intentProfile.primary_intent}
            </span>
          </div>
        </div>
      )}

      {intentProfile.category_focus && intentProfile.category_focus.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--aacp-muted)",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Categorias de interesse
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            {intentProfile.category_focus.map((cat) => (
              <span
                key={cat}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)",
                  color: "var(--aacp-accent)",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {intentProfile.budget_tier && (
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--aacp-muted)",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Faixa de orçamento
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--aacp-surface-2)",
              border: "1px solid var(--aacp-line)",
            }}
          >
            <IconCheck />
            <span
              style={{
                fontSize: "13px",
                color: "var(--aacp-fg)",
                fontWeight: 500,
                textTransform: "capitalize",
              }}
            >
              {intentProfile.budget_tier}
            </span>
          </div>
        </div>
      )}

      {typeof intentProfile.conversion_likelihood === "number" && (
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--aacp-muted)",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            Taxa de conversão estimada
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "var(--aacp-surface-2)",
              border: "1px solid var(--aacp-line)",
            }}
          >
            <div
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "4px",
                background: "var(--aacp-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--aacp-panel-bg)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              %
            </div>
            <span style={{ fontSize: "13px", color: "var(--aacp-fg)", fontWeight: 500 }}>
              {fmtPercent(intentProfile.conversion_likelihood)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function PreferencesTab({
  preferences,
  intentProfile,
  loading,
  onUpdatePreference,
}: PreferencesTabProps) {
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const handleToggle = useCallback(
    async (key: string) => {
      if (!preferences) return;
      setLocalErrors((prev) => ({ ...prev, [key]: "" }));
      try {
        const newValue = !preferences[key as keyof BuyerPreferences];
        await onUpdatePreference(key, newValue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar preferência";
        setLocalErrors((prev) => ({ ...prev, [key]: msg }));
      }
    },
    [preferences, onUpdatePreference],
  );

  const handleLanguageChange = useCallback(
    async (value: string) => {
      setLocalErrors((prev) => ({ ...prev, language: "" }));
      try {
        await onUpdatePreference("language", value);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar idioma";
        setLocalErrors((prev) => ({ ...prev, language: msg }));
      }
    },
    [onUpdatePreference],
  );

  const currentLanguage = preferences?.language ?? "pt-BR";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        padding: "20px",
        paddingBottom: "16px",
      }}
    >
      {/* Notification Preferences */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "12px",
            letterSpacing: "0.5px",
          }}
        >
          Notificações
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-card)",
            padding: "8px 12px",
            overflow: "hidden",
          }}
        >
          {preferences ? (
            <>
              <ToggleSwitch
                value={preferences.email_opt_in}
                onChange={() => handleToggle("email_opt_in")}
                label="Email"
                description="Receba atualizações e promoções por email"
              />
              <div style={{ height: "1px", background: "var(--aacp-line)" }} />
              <ToggleSwitch
                value={preferences.sms_opt_in}
                onChange={() => handleToggle("sms_opt_in")}
                label="SMS"
                description="Indisponível no momento"
                disabled
              />
              <div style={{ height: "1px", background: "var(--aacp-line)" }} />
              <ToggleSwitch
                value={preferences.whatsapp_opt_in}
                onChange={() => handleToggle("whatsapp_opt_in")}
                label="WhatsApp"
                description="Receba atualizações no WhatsApp"
              />
              <div style={{ height: "1px", background: "var(--aacp-line)" }} />
              <ToggleSwitch
                value={preferences.push_notifications_enabled}
                onChange={() => handleToggle("push_notifications_enabled")}
                label="Notificações push"
                description="Receba notificações do navegador"
              />
            </>
          ) : (
            <div style={{ padding: "12px", color: "var(--aacp-muted)", fontSize: "13px" }}>
              Carregando preferências…
            </div>
          )}
        </div>
        {Object.keys(localErrors).some((k) => k.startsWith("email") || k.startsWith("sms") || k.startsWith("whatsapp") || k.startsWith("push")) &&
          Object.entries(localErrors).map(([key, msg]) =>
            msg ? (
              <div
                key={key}
                role="alert"
                style={{
                  marginTop: "6px",
                  fontSize: "11px",
                  color: "#ef4444",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: "color-mix(in srgb, #ef4444 10%, transparent)",
                }}
              >
                {msg}
              </div>
            ) : null,
          )}
      </div>

      {/* M2M Negotiation */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "12px",
            letterSpacing: "0.5px",
          }}
        >
          Experiência
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-card)",
            padding: "8px 12px",
            overflow: "hidden",
          }}
        >
          {preferences ? (
            <ToggleSwitch
              value={preferences.m2m_negotiation_enabled}
              onChange={() => handleToggle("m2m_negotiation_enabled")}
              label="Permitir negociações de preço"
              description="Receba ofertas personalizadas ao finalizar compras"
            />
          ) : (
            <div style={{ padding: "12px", color: "var(--aacp-muted)", fontSize: "13px" }}>
              Carregando preferências…
            </div>
          )}
        </div>
        {localErrors.m2m_negotiation_enabled && (
          <div
            role="alert"
            style={{
              marginTop: "6px",
              fontSize: "11px",
              color: "#ef4444",
              padding: "6px 8px",
              borderRadius: "4px",
              background: "color-mix(in srgb, #ef4444 10%, transparent)",
            }}
          >
            {localErrors.m2m_negotiation_enabled}
          </div>
        )}
      </div>

      {/* Language */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "12px",
            letterSpacing: "0.5px",
          }}
        >
          Preferências regionais
        </div>
        <LanguageSelect value={currentLanguage} onChange={handleLanguageChange} />
        {localErrors.language && (
          <div
            role="alert"
            style={{
              marginTop: "6px",
              fontSize: "11px",
              color: "#ef4444",
              padding: "6px 8px",
              borderRadius: "4px",
              background: "color-mix(in srgb, #ef4444 10%, transparent)",
            }}
          >
            {localErrors.language}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--aacp-line)" }} />

      {/* Intent Profile */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "12px",
            letterSpacing: "0.5px",
          }}
        >
          Perfil de intenção
        </div>
        <IntentProfileSection intentProfile={intentProfile ?? null} loading={loading} />
      </div>

      {/* Privacy Notice */}
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: "color-mix(in srgb, var(--aacp-accent) 5%, transparent)",
          border: "1px solid var(--aacp-line)",
          fontSize: "11px",
          color: "var(--aacp-muted)",
          lineHeight: 1.6,
        }}
      >
        Suas preferências são armazenadas com segurança. Você pode alterar estas configurações a qualquer momento. Para saber mais sobre como usamos seus dados, leia nossa{" "}
        <a
          href="/privacidade"
          style={{
            color: "var(--aacp-accent)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Política de Privacidade
        </a>
        .
      </div>
    </div>
  );
}
