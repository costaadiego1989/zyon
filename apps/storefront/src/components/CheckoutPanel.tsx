"use client";

import { useState, useEffect } from "react";
import { PulseCheckoutView } from "@zyon/widget";
import type { CheckoutProps } from "@zyon/widget";

interface CheckoutPanelProps {
  merchantId: string;
  globalUserId: string;
  cartRef: string | undefined;
  onClose: () => void;
}

export default function CheckoutPanel({
  merchantId,
  globalUserId,
  cartRef,
  onClose,
}: CheckoutPanelProps) {
  const [embedToken, setEmbedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Generate embed token server-side
    fetch("/api/checkout-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        cart_ref: cartRef,
        allowed_origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.embed_session_token) {
          setEmbedToken(data.embed_session_token);
        } else {
          setError("Falha ao iniciar checkout");
        }
      })
      .catch((err) => {
        console.error("[CheckoutPanel] Token generation failed:", err);
        setError("Erro ao conectar com servidor de checkout");
      });
  }, [merchantId, cartRef]);

  if (error) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "var(--aacp-bg, #0a0a0f)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
      >
        <div style={{ textAlign: "center", color: "var(--aacp-tx, #f0f0f0)" }}>
          <p style={{ marginBottom: "16px" }}>{error}</p>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              background: "var(--aacp-chip, #1a1a2e)",
              border: "1px solid var(--aacp-bd, #333)",
              color: "var(--aacp-tx, #f0f0f0)",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (!embedToken) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "var(--aacp-bg, #0a0a0f)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--aacp-tx, #f0f0f0)",
          fontSize: "16px",
        }}
      >
        Carregando checkout...
      </div>
    );
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

  const checkoutProps: CheckoutProps = {
    apiBaseUrl: apiBase,
    merchantId,
    sessionToken: embedToken,
    cartRef,
    storeName: "Loja",
    agentName: "Pulse",
    theme: "dark",
    faceLogin: true,
    voiceEnabled: true,
    supportFab: true,
    allowDemoFallbacks: false,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--aacp-bg, #0a0a0f)",
        overflow: "hidden",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          zIndex: 10000,
          background: "var(--aacp-chip, #1a1a2e)",
          border: "1px solid var(--aacp-bd, #333)",
          color: "var(--aacp-tx, #f0f0f0)",
          borderRadius: "4px",
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: "500",
        }}
      >
        ✕ Voltar
      </button>

      <PulseCheckoutView {...checkoutProps} />
    </div>
  );
}
