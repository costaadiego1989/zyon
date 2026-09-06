"use client";

import { useState, useCallback, useRef } from "react";
import { OtpInput } from "./OtpInput";
import { conversationAccessHeaders } from "@/lib/conversation-access";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function trackRegistrationStep(merchantId: string | undefined, event: string) {
  if (!merchantId) return;
  const sessionId = typeof sessionStorage !== "undefined"
    ? sessionStorage.getItem("zyon_conversation_id") ?? "unknown"
    : "unknown";
  fetch(`${API_BASE}/storefront/conversations/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...conversationAccessHeaders(sessionId) },
    body: JSON.stringify({ merchant_id: merchantId, event, metadata: { timestamp: new Date().toISOString() } }),
  }).catch(() => {});
}

type Props = {
  merchantId?: string;
  merchantName?: string;
  onComplete: (globalUserId: string) => void | Promise<void>;
  onCancel: () => void;
};

type StepConfig = {
  step: number;
  label: string;
  placeholder: string;
  type: string;
};

const STEPS: StepConfig[] = [
  { step: 1, label: "celular", placeholder: "(11) 99999-9999", type: "tel" },
  { step: 2, label: "código de verificação", placeholder: "000000", type: "text" },
  { step: 3, label: "e-mail", placeholder: "voce@email.com", type: "email" },
  { step: 4, label: "código do e-mail", placeholder: "000000", type: "text" },
  { step: 5, label: "nome e CPF", placeholder: "", type: "text" },
  { step: 6, label: "endereço", placeholder: "", type: "text" },
];

type AddressData = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Validates CPF check digits (rejects wrong-length, all-equal, and bad checksums). */
function isValidCPF(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export default function BuyerRegistrationForm({ merchantId, merchantName, onComplete, onCancel }: Props) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [cep, setCep] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [address, setAddress] = useState<AddressData | null>(null);
  const [cepLoading, setCepLoading] = useState(false);

  const phoneDigits = phone.replace(/\D/g, "");

  const handleBack = () => {
    setError("");
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const fetchCep = useCallback(async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setAddress({
          street: data.logradouro || "",
          neighborhood: data.bairro || "",
          city: data.localidade || "",
          state: data.uf || "",
        });
      } else {
        setError("CEP não encontrado");
      }
    } catch {
      setError("Erro ao buscar CEP");
    } finally {
      setCepLoading(false);
    }
  }, []);

  const handleConfirm = async () => {
    setError("");
    setLoading(true);

    try {
      switch (currentStep) {
        case 1: {
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
          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => null);
            throw new Error(errData?.message ?? "Erro ao enviar código");
          }
          if (res.status === 404) {
            if (process.env.NODE_ENV === 'development') {
              console.warn("[BuyerRegistrationForm] send-otp endpoint not found (404), skipping for dev");
            } else {
              throw new Error("Serviço de verificação indisponível");
            }
          }
          setCurrentStep(2);
          trackRegistrationStep(merchantId, "auth_phone_submitted");
          break;
        }
        case 2: {
          const res = await fetch(`${API_BASE}/buyer/phone/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: phoneDigits, code: phoneOtp }),
          });
          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => null);
            throw new Error(errData?.message ?? "Código inválido");
          }
          if (res.status === 404) {
            if (process.env.NODE_ENV === 'development') {
              console.warn("[BuyerRegistrationForm] verify-otp endpoint not found (404), skipping for dev");
            } else {
              throw new Error("Serviço de verificação indisponível");
            }
          }
          setCurrentStep(3);
          trackRegistrationStep(merchantId, "auth_phone_verified");
          break;
        }
        case 3: {
          const res = await fetch(`${API_BASE}/buyer/email/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, merchant_id: merchantId }),
          });
          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => null);
            throw new Error(errData?.detail ?? "Erro ao enviar código");
          }
          if (res.status === 404) {
            if (process.env.NODE_ENV !== 'development') {
              throw new Error("Serviço de verificação indisponível");
            }
          }
          setCurrentStep(4);
          trackRegistrationStep(merchantId, "auth_email_submitted");
          break;
        }
        case 4: {
          const res = await fetch(`${API_BASE}/buyer/email/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code: emailOtp, merchant_id: merchantId }),
          });
          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => null);
            throw new Error(errData?.detail ?? "Código inválido");
          }
          if (res.status === 404) {
            if (process.env.NODE_ENV !== 'development') {
              throw new Error("Serviço de verificação indisponível");
            }
          }
          setCurrentStep(5);
          trackRegistrationStep(merchantId, "auth_email_verified");
          break;
        }
        case 5: {
          if (!name.trim() || name.trim().split(" ").length < 2) {
            throw new Error("Informe seu nome completo");
          }
          if (!isValidCPF(cpf)) {
            throw new Error("CPF inválido. Verifique os dígitos.");
          }
          setCurrentStep(6);
          trackRegistrationStep(merchantId, "auth_identity_confirmed");
          break;
        }
        case 6: {
          if (!address) {
            throw new Error("Busque o CEP primeiro");
          }
          if (!numero.trim()) {
            throw new Error("Informe o número");
          }
          const cpfDigits = cpf.replace(/\D/g, "");
          const cepDigits = cep.replace(/\D/g, "");

          const res = await fetch(`${API_BASE}/buyer/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: phoneDigits,
              email,
              name: name.trim(),
              cpf: cpfDigits,
              ...(dateOfBirth ? { dateOfBirth } : {}),
              ...(gender ? { gender } : {}),
              address: {
                zip: cepDigits,
                street: address.street,
                neighborhood: address.neighborhood,
                city: address.city,
                state: address.state,
                number: numero.trim(),
                complement: complemento.trim() || undefined,
              },
            }),
          });

          if (!res.ok && res.status !== 404) {
            const errData = await res.json().catch(() => null);
            throw new Error(errData?.message ?? "Erro ao registrar");
          }

          let globalUserId: string;
          if (res.ok) {
            const data = await res.json();
            const token = data.accessToken ?? data.access_token ?? data.token;
            const respEmail = data.email ?? email;
            if (token) {
              localStorage.setItem("zyon_buyer_token", token);
            }
            globalUserId = data.globalUserId ?? data.global_user_id;
            if (!globalUserId) {
              throw new Error("Registro falhou: servidor não retornou identificação do usuário");
            }
            localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId, token, email: respEmail }));
          } else if (res.status === 404) {
            if (process.env.NODE_ENV === 'development') {
              console.warn("[BuyerRegistrationForm] register endpoint not found (404), using mock token for dev");
              localStorage.setItem("zyon_buyer_token", "dev-mock-token");
              globalUserId = "dev-new-buyer";
            } else {
              throw new Error("Serviço de registro indisponível");
            }
          } else {
            throw new Error("Erro ao registrar");
          }

          trackRegistrationStep(merchantId, "auth_registration_completed");
          await onComplete(globalUserId);
          break;
        }
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

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: "9px",
    letterSpacing: "1px",
    textTransform: "uppercase",
    color: "var(--aacp-muted, #8b8b95)",
  };

  const stepLabelStyle: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: "9px",
    color: "var(--aacp-muted, #8b8b95)",
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

  const backBtnStyle: React.CSSProperties = {
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
  };

  const confirmBtnStyle: React.CSSProperties = {
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
  };

  const readonlyFieldStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "var(--aacp-fg, #f5f5f7)",
    padding: "4px 0",
    lineHeight: 1.6,
  };

  const stepConfig = STEPS[currentStep - 1];

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={labelStyle}>Seus dados · {stepConfig.label}</span>
        <span style={stepLabelStyle}>Passo {currentStep}/6</span>
      </div>

      {/* Content per step */}
      {currentStep === 1 && (
        <div style={inputWrapStyle}>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder={stepConfig.placeholder}
            type={stepConfig.type}
            inputMode="tel"
            autoFocus
            aria-label="Celular"
            style={inputStyle}
          />
        </div>
      )}

      {currentStep === 2 && (
        <OtpInput
          value={phoneOtp}
          onChange={setPhoneOtp}
          length={6}
          autoFocus
          label="Código de verificação do celular"
        />
      )}

      {currentStep === 3 && (
        <div style={inputWrapStyle}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={stepConfig.placeholder}
            type="email"
            autoFocus
            aria-label="E-mail"
            style={inputStyle}
          />
        </div>
      )}

      {currentStep === 4 && (
        <OtpInput
          value={emailOtp}
          onChange={setEmailOtp}
          length={6}
          autoFocus
          label="Código de verificação do e-mail"
        />
      )}

      {currentStep === 5 && (
        <>
          <div style={inputWrapStyle}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              type="text"
              autoFocus
              aria-label="Nome completo"
              style={inputStyle}
            />
          </div>
          <div style={inputWrapStyle}>
            <input
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              placeholder="000.000.000-00"
              type="text"
              inputMode="numeric"
              aria-label="CPF"
              style={inputStyle}
            />
          </div>
          <div style={inputWrapStyle}>
            <input
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              type="date"
              aria-label="Data de nascimento (opcional)"
              style={inputStyle}
            />
          </div>
          <div style={inputWrapStyle}>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              aria-label="Gênero (opcional)"
              style={inputStyle}
            >
              <option value="">Gênero (opcional)</option>
              <option value="feminino">Feminino</option>
              <option value="masculino">Masculino</option>
              <option value="nao_binario">Não-binário</option>
              <option value="outro">Outro</option>
              <option value="prefiro_nao_informar">Prefiro não informar</option>
            </select>
          </div>
        </>
      )}

      {currentStep === 6 && (
        <>
          <div style={inputWrapStyle}>
            <input
              value={cep}
              onChange={(e) => {
                const formatted = formatCEP(e.target.value);
                setCep(formatted);
                const digits = formatted.replace(/\D/g, "");
                if (digits.length === 8) {
                  fetchCep(digits);
                }
              }}
              onBlur={() => {
                const digits = cep.replace(/\D/g, "");
                if (digits.length === 8 && !address) fetchCep(digits);
              }}
              placeholder="00000-000"
              type="text"
              inputMode="numeric"
              autoFocus
              aria-label="CEP"
              style={inputStyle}
            />
            {cepLoading && (
              <span style={{ fontSize: "10px", color: "var(--aacp-muted)", flexShrink: 0 }}>...</span>
            )}
          </div>

          {address && (
            <div style={{ ...readonlyFieldStyle, padding: "6px 8px", background: "var(--aacp-surface-2, rgba(255,255,255,0.05))", borderRadius: "10px" }}>
              <div>Rua: {address.street} ✓</div>
              <div>Bairro: {address.neighborhood} ✓</div>
              <div>Cidade: {address.city} - {address.state} ✓</div>
            </div>
          )}

          <div style={inputWrapStyle}>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Número"
              type="text"
              inputMode="numeric"
              aria-label="Número"
              style={inputStyle}
            />
          </div>
          <div style={inputWrapStyle}>
            <input
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              placeholder="Complemento (opcional)"
              type="text"
              aria-label="Complemento"
              style={inputStyle}
            />
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <p style={{ margin: 0, fontSize: "11.5px", color: "#f87171", padding: "0 2px" }}>{error}</p>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        {currentStep > 1 && (
          <button type="button" onClick={handleBack} style={backBtnStyle}>
            Voltar
          </button>
        )}
        <button type="button" onClick={handleConfirm} disabled={loading} style={confirmBtnStyle}>
          {loading ? "..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
