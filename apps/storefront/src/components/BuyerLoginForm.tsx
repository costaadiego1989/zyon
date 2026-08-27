"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

type Props = {
  merchantId?: string;
  merchantName?: string;
  onComplete: (globalUserId: string) => void | Promise<void>;
  onCancel: () => void;
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export default function BuyerLoginForm({ merchantId, merchantName, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const phoneDigits = phone.replace(/\D/g, "");

  const handleConfirm = async () => {
    setError("");
    setLoading(true);

    try {
      if (step === 1) {
        // Send OTP — include fallback email from prior session if available
        let fallbackEmail: string | undefined;
        try {
          const session = localStorage.getItem("zyon_buyer_session");
          if (session) {
            const parsed = JSON.parse(session);
            if (parsed.email) fallbackEmail = parsed.email;
          }
        } catch {}

        const res = await fetch(`${API_BASE}/buyer/phone/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phoneDigits, merchant_name: merchantName, fallback_email: fallbackEmail }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message ?? "Erro ao enviar código");
        }
        // OTP enviado via WhatsApp/SMS — buyer verifica no celular
        setStep(2);
      } else {
        // Verify OTP
        const res = await fetch(`${API_BASE}/buyer/phone/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phoneDigits, code: otp }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message ?? "Código inválido");
        }

        const data = await res.json();
        const globalUserId = data.globalUserId ?? data.global_user_id;
        if (!globalUserId) {
          throw new Error("Login falhou: servidor não retornou identificação do usuário");
        }
        const token = data.accessToken ?? data.access_token ?? data.token;
        const email = data.email;
        if (token) {
          localStorage.setItem("zyon_buyer_token", token);
          localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId, token, email }));
        }

        await onComplete(globalUserId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "11px",
    background: "var(--aacp-surface, #1a1a1a)",
    borderRadius: "18px",
    border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
  };

  const inputWrapStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
    background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
    borderRadius: "12px",
    padding: "9px 13px",
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--aacp-fg, #f5f5f7)",
    fontSize: "13.5px",
    padding: 0,
    fontFamily: "inherit",
  };

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "9px",
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: "var(--aacp-muted, #8b8b95)",
          }}
        >
          Login · {step === 1 ? "celular" : "código de verificação"}
        </span>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "9px",
            color: "var(--aacp-muted, #8b8b95)",
          }}
        >
          Passo {step}/2
        </span>
      </div>

      {/* Input */}
      {step === 1 && (
        <div style={inputWrapStyle}>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="(11) 99999-9999"
            type="tel"
            inputMode="tel"
            autoFocus
            aria-label="Celular"
            style={inputStyle}
          />
        </div>
      )}

      {step === 2 && (
        <div style={inputWrapStyle}>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            aria-label="Código de verificação"
            style={inputStyle}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ margin: 0, fontSize: "11.5px", color: "#f87171", padding: "0 2px" }}>{error}</p>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        {step === 2 && (
          <button
            type="button"
            onClick={() => { setStep(1); setError(""); }}
            style={{
              flex: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "var(--aacp-muted, #8b8b95)",
              padding: "10px 14px",
              borderRadius: "11px",
              border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
              background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
            }}
          >
            Voltar
          </button>
        )}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          style={{
            flex: 1,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "12.5px",
            fontWeight: 600,
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "11px",
            background: "var(--aacp-accent, #0f766e)",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}