"use client";

import { useState, useEffect } from "react";
import { intentMemoryApi } from "@/lib/api/api-client";

const AUTH_STORAGE_KEY = "aacp_buyer_auth_session";

type AuthSession = {
  global_user_id: string;
  email: string;
  access_token: string;
  expires_at: number;
  phone: string;
};

function safeReadSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    if (!s.global_user_id || !s.access_token) return null;
    if (s.expires_at && Date.now() >= s.expires_at) return null;
    return s;
  } catch {
    return null;
  }
}

type ConsentData = {
  has_consent: boolean;
  consented_at?: string;
  primary_intent?: string;
  category_focus?: string[];
  budget_tier?: string;
};

export default function PrivacidadePage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [consent, setConsent] = useState<ConsentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    const s = safeReadSession();
    setSession(s);
    if (!s) {
      setLoading(false);
      return;
    }
    intentMemoryApi
      .getConsent(s.access_token)
      .then((data) => {
        setConsent(data ?? { has_consent: false });
      })
      .catch(() => {
        setConsent({ has_consent: false });
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    const success = await intentMemoryApi.deleteConsent(session.access_token);
    setDeleting(false);
    if (success) {
      setDeleted(true);
      setConsent({ has_consent: false });
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        background: "var(--color-bg, #0e0e10)",
        color: "var(--color-fg, #e4e4e7)",
      }}
    >
      <div style={{ maxWidth: 540, width: "100%" }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 8,
            letterSpacing: "-0.01em",
          }}
        >
          Seus Dados de Personalização
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-fg-soft, #a1a1aa)",
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          Transparência sobre como seus dados de intenção de compra são utilizados (LGPD).
        </p>

        {loading ? (
          <div style={{ fontSize: 14, color: "var(--color-fg-soft, #a1a1aa)" }}>
            Carregando...
          </div>
        ) : !session ? (
          <div
            style={{
              padding: "24px",
              borderRadius: 12,
              border: "1px solid var(--color-border, #27272a)",
              background: "var(--color-bg-soft, #18181b)",
            }}
          >
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              Para visualizar ou gerenciar seus dados de personalização, faça login na sua conta.
            </p>
            <a
              href="/store/demo"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                borderRadius: 8,
                background: "var(--color-primary, #7c3aed)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Fazer login
            </a>
          </div>
        ) : deleted ? (
          <div
            style={{
              padding: "24px",
              borderRadius: 12,
              border: "1px solid #22c55e33",
              background: "#22c55e11",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 600, color: "#22c55e" }}>
              Dados apagados com sucesso.
            </p>
            <p style={{ fontSize: 13, color: "var(--color-fg-soft, #a1a1aa)", marginTop: 8 }}>
              Seus dados de personalização foram removidos. A personalização pode ser reativada no checkout.
            </p>
          </div>
        ) : consent?.has_consent ? (
          <div
            style={{
              padding: "24px",
              borderRadius: 12,
              border: "1px solid var(--color-border, #27272a)",
              background: "var(--color-bg-soft, #18181b)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "var(--color-fg-soft, #a1a1aa)",
                  marginBottom: 6,
                }}
              >
                Perfil detectado
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {consent.primary_intent ?? "Geral"}
              </div>
            </div>

            {consent.category_focus && consent.category_focus.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: "var(--color-fg-soft, #a1a1aa)",
                    marginBottom: 6,
                  }}
                >
                  Categorias de interesse
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {consent.category_focus.map((cat) => (
                    <span
                      key={cat}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        background: "var(--color-primary, #7c3aed)22",
                        color: "var(--color-primary, #7c3aed)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {consent.budget_tier && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: "var(--color-fg-soft, #a1a1aa)",
                    marginBottom: 6,
                  }}
                >
                  Faixa de orçamento
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, textTransform: "capitalize" }}>
                  {consent.budget_tier}
                </div>
              </div>
            )}

            {consent.consented_at && (
              <div style={{ fontSize: 12, color: "var(--color-fg-soft, #a1a1aa)" }}>
                Dados coletados com seu consentimento em{" "}
                {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(
                  new Date(consent.consented_at),
                )}
              </div>
            )}

            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                marginTop: 8,
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid #ef4444",
                background: "transparent",
                color: "#ef4444",
                fontWeight: 600,
                fontSize: 13,
                cursor: deleting ? "not-allowed" : "pointer",
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Apagando..." : "Apagar meus dados"}
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: "24px",
              borderRadius: 12,
              border: "1px solid var(--color-border, #27272a)",
              background: "var(--color-bg-soft, #18181b)",
            }}
          >
            <p style={{ fontSize: 14, marginBottom: 8 }}>
              Nenhum dado de personalização coletado.
            </p>
            <p style={{ fontSize: 13, color: "var(--color-fg-soft, #a1a1aa)" }}>
              Para ativar a personalização, aceite no checkout.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
