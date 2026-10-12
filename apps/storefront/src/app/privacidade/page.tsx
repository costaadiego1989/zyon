"use client";

import { useState, useEffect } from "react";
import { intentMemoryApi } from "@/lib/api/api-client";
import { getValidBuyer, type ValidBuyer } from "@/lib/buyer-auth";

const AUTH_STORAGE_KEY = "aacp_buyer_auth_session";

type AuthSession = {
  global_user_id: string;
  email: string;
  access_token: string;
  expires_at: number;
  phone: string;
};

function safeReadSession(): ValidBuyer | null {
  if (typeof window === "undefined") return null;
  const current = getValidBuyer();
  if (current) return current;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    if (!s.global_user_id || !s.access_token) return null;
    if (s.expires_at && Date.now() >= s.expires_at) return null;
    return { globalUserId: s.global_user_id, token: s.access_token, email: s.email };
  } catch {
    return null;
  }
}

type ConsentData = {
  has_consent: boolean;
  has_data?: boolean;
  consented_at?: string;
  primary_intent?: string;
  category_focus?: string[];
  budget_tier?: string;
};

export default function PrivacidadePage() {
  const [session, setSession] = useState<ValidBuyer | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .getConsent(s.token)
      .then((data) => {
        setConsent(data ?? { has_consent: false });
      })
      .catch(() => {
        setError("Não foi possível consultar seus dados. Tente novamente ou fale com o contato de privacidade.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete() {
    if (!session) return;
    setDeleting(true);
    setError(null);
    const success = await intentMemoryApi.deleteConsent(session.token);
    setDeleting(false);
    if (success) {
      setDeleted(true);
      setConsent({ has_consent: false });
    } else {
      setError("Não foi possível confirmar a remoção. Seus dados continuam disponíveis; tente novamente.");
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
        <a href="/politicas/privacidade" style={{ color: "inherit", display: "inline-flex", minHeight: 44, alignItems: "center" }}>Ler a Política de Privacidade completa</a>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-fg-soft, #a1a1aa)",
            marginBottom: 32,
            lineHeight: 1.6,
          }}
        >
          Consulte e remova a memória de intenção de compra. Essa ação não apaga pedidos, sua conta ou outras preferências.
        </p>

        {error && <p role="alert" style={{ color: "#f87171", marginBottom: 20 }}>{error} <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button></p>}
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
              href="https://www.zyon-payments.com.br"
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
              Voltar à Zyon
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
              A memória de intenção de compra e sua autorização foram removidas. Pedidos e outras preferências permanecem na conta.
            </p>
          </div>
        ) : consent?.has_consent || consent?.has_data ? (
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

            <button data-neu="control"
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
              {deleting ? "Removendo..." : "Remover memória de intenção"}
            </button>
          </div>
        ) : error ? null : (
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
              A memória de intenção depende de autorização própria; aceitar cookies ou campanhas não a ativa.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
