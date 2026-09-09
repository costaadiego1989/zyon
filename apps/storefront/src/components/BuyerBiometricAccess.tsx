"use client";
import { useEffect, useState } from "react";
import { FiShield } from "react-icons/fi";
import { biometricError, loginBuyerPasskey, registerBuyerPasskey, supportsPasskeys } from "@/lib/buyer-webauthn";

export function BuyerBiometricAccess({ enroll = false, onComplete }: {
  enroll?: boolean; onComplete?: (buyerId: string) => void | Promise<void>;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enrolled, setEnrolled] = useState(false);
  useEffect(() => { setAvailable(supportsPasskeys()); }, []);

  async function activate() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (enroll) {
        await registerBuyerPasskey();
        setEnrolled(true);
        setMessage("Biometria ativada. No próximo acesso, escolha Entrar com biometria.");
      } else {
        const buyerId = await loginBuyerPasskey();
        await onComplete?.(buyerId);
      }
    } catch (error) { setMessage(biometricError(error)); }
    finally { setBusy(false); }
  }
  return <div style={{ display: "grid", gap: 8 }}>
    <button type="button" disabled={!available || busy || enrolled} onClick={activate} aria-busy={busy}
      style={{ width: "100%", minHeight: 46, padding: "12px 16px", borderRadius: 12,
        border: "1px solid var(--aacp-line)", background: "var(--aacp-surface-2)",
        color: "var(--aacp-fg)", font: "inherit", fontSize: 14, fontWeight: 600,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        opacity: available && !busy ? 1 : 0.55, cursor: available && !busy ? "pointer" : "default" }}>
      <FiShield aria-hidden />
      {busy ? "Confirme no seu dispositivo…" : enrolled ? "Biometria ativada" : enroll ? "Ativar Face ID / biometria" : "Entrar com biometria"}
    </button>
    <p style={{ margin: 0, fontSize: 12, color: "var(--aacp-muted)", lineHeight: 1.5 }}>
      {available
        ? enroll ? "Use Face ID, impressão digital ou o PIN do dispositivo. Seus dados biométricos ficam no dispositivo."
          : "Use uma chave de acesso já ativada. Para ativar, entre por e-mail e acesse as configurações do Hub."
        : "Biometria indisponível neste navegador. O acesso por e-mail continua disponível."}
    </p>
    {message && <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--aacp-fg)", lineHeight: 1.5 }}>{message}</p>}
  </div>;
}
