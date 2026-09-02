import React, { useState } from "react";
import { Button } from "../../../components/Button.js";

/**
 * Asaas subaccount (BaaS) form. Asaas has no OAuth — a white-label subaccount is
 * created via API with the 9 required fields, then the merchant completes
 * document onboarding through a link.
 *
 * Most fields are pre-filled from storeSettings.company (collected at signup /
 * onboarding: cnpj, razaoSocial, email, phone, address). The two fields never
 * collected anywhere — income_value and birth_date — default to hardcoded values
 * so the merchant can connect in one click and adjust later if needed.
 */

export interface AsaasSubaccountPayload {
  name: string;
  email: string;
  cpf_cnpj: string;
  mobile_phone: string;
  income_value: number;
  address: string;
  address_number: string;
  province: string;
  postal_code: string;
  birth_date?: string;
  complement?: string;
}

// Hardcoded defaults for data not collected anywhere in the system.
const DEFAULT_INCOME_VALUE = 10000;
const DEFAULT_BIRTH_DATE = "1990-01-01";

interface CompanyPrefill {
  cnpj?: string;
  razaoSocial?: string;
  email?: string;
  phone?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    zip?: string;
  };
}

interface AsaasSubaccountFormProps {
  company: CompanyPrefill | null;
  defaultName?: string;
  saving: boolean;
  onSubmit: (payload: AsaasSubaccountPayload) => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--surface-1)",
  color: "var(--color-text)",
  font: "13px var(--font-sans)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  font: "600 11px var(--font-sans)",
  color: "var(--color-text-muted)",
  marginBottom: 4,
  display: "block",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export function AsaasSubaccountForm({ company, defaultName, saving, onSubmit, onCancel }: AsaasSubaccountFormProps) {
  const addr = company?.address ?? {};
  const [name, setName] = useState(company?.razaoSocial ?? defaultName ?? "");
  const [email, setEmail] = useState(company?.email ?? "");
  const [cpfCnpj, setCpfCnpj] = useState(company?.cnpj ?? "");
  const [mobilePhone, setMobilePhone] = useState(company?.phone ?? "");
  const [address, setAddress] = useState(addr.street ?? "");
  const [addressNumber, setAddressNumber] = useState(addr.number ?? "");
  const [province, setProvince] = useState(addr.neighborhood ?? "");
  const [postalCode, setPostalCode] = useState(addr.zip ?? "");
  const [error, setError] = useState<string | null>(null);

  const digits = (s: string) => s.replace(/\D+/g, "");

  function validateAndSubmit() {
    setError(null);
    const cpf = digits(cpfCnpj);
    if (!name.trim()) return setError("Informe o nome / razão social.");
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return setError("E-mail inválido.");
    if (cpf.length !== 11 && cpf.length !== 14) return setError("CPF (11) ou CNPJ (14) inválido.");
    if (digits(mobilePhone).length < 10) return setError("Celular inválido (com DDD).");
    if (!address.trim() || !addressNumber.trim() || !province.trim()) return setError("Preencha o endereço completo.");
    if (digits(postalCode).length !== 8) return setError("CEP inválido (8 dígitos).");

    onSubmit({
      name: name.trim(),
      email: email.trim(),
      cpf_cnpj: cpf,
      mobile_phone: digits(mobilePhone),
      income_value: DEFAULT_INCOME_VALUE,
      birth_date: DEFAULT_BIRTH_DATE,
      address: address.trim(),
      address_number: addressNumber.trim(),
      province: province.trim(),
      postal_code: digits(postalCode),
      ...(addr.complement ? { complement: addr.complement } : {}),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
        Preenchemos com os dados da sua loja. Confira e crie a subconta Asaas — você conclui o cadastro (documentos) por um link.
      </p>

      <Field label="Nome / Razão social">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do titular" />
      </Field>
      <Field label="E-mail">
        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dominio.com" />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Field label="CPF ou CNPJ">
          <input style={inputStyle} value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} placeholder="Somente números" inputMode="numeric" />
        </Field>
        <Field label="Celular (com DDD)">
          <input style={inputStyle} value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} placeholder="11999999999" inputMode="numeric" />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <Field label="Endereço">
          <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua/Av." />
        </Field>
        <div style={{ width: 90 }}>
          <label style={labelStyle}>Número</label>
          <input style={inputStyle} value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} placeholder="123" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Field label="Bairro">
          <input style={inputStyle} value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Bairro" />
        </Field>
        <Field label="CEP">
          <input style={inputStyle} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="00000000" inputMode="numeric" />
        </Field>
      </div>

      {error ? (
        <div style={{ font: "12px var(--font-sans)", color: "var(--color-danger, #dc2626)" }}>{error}</div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button variant="ghost" size="sm" onClick={onCancel} style={{ flex: 1 }} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={validateAndSubmit} loading={saving} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Criando..." : "Criar subconta"}
        </Button>
      </div>
    </div>
  );
}
