import React, { useState } from "react";
import { Button } from "../../../components/Button.js";
import { maskCpfCnpj, maskPhone, maskCEP, validateCpfCnpj } from "../../../utils/masks.js";
import { lookupViaCep } from "../../../api/external/via-cep.js";

/**
 * Asaas subaccount (BaaS) form. Asaas has no OAuth — a white-label subaccount is
 * created via API with the 9 required fields, then the merchant completes
 * document onboarding through a link.
 *
 * Pre-filled from storeSettings.company. CEP comes first in the address block and
 * autofills street/neighborhood via ViaCEP. Inputs are masked (CNPJ/phone/CEP);
 * the payload is normalized (digits only) on submit. income_value/birth_date are
 * hardcoded defaults (never collected anywhere).
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

const digits = (s: string) => s.replace(/\D+/g, "");

export function AsaasSubaccountForm({ company, defaultName, saving, onSubmit, onCancel }: AsaasSubaccountFormProps) {
  const addr = company?.address ?? {};
  const [name, setName] = useState(company?.razaoSocial ?? defaultName ?? "");
  const [email, setEmail] = useState(company?.email ?? "");
  const [cpfCnpj, setCpfCnpj] = useState(company?.cnpj ? maskCpfCnpj(company.cnpj) : "");
  const [mobilePhone, setMobilePhone] = useState(company?.phone ? maskPhone(company.phone) : "");
  const [postalCode, setPostalCode] = useState(addr.zip ? maskCEP(addr.zip) : "");
  const [address, setAddress] = useState(addr.street ?? "");
  const [addressNumber, setAddressNumber] = useState(addr.number ?? "");
  const [province, setProvince] = useState(addr.neighborhood ?? "");
  const [cepLoading, setCepLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCepChange(raw: string) {
    const masked = maskCEP(raw);
    setPostalCode(masked);
    const cep = digits(masked);
    if (cep.length === 8) {
      setCepLoading(true);
      try {
        const info = await lookupViaCep(cep);
        if (info) {
          if (info.logradouro) setAddress(info.logradouro);
          if (info.bairro) setProvince(info.bairro);
        }
      } finally {
        setCepLoading(false);
      }
    }
  }

  function validateAndSubmit() {
    setError(null);
    const cpf = digits(cpfCnpj);
    if (!name.trim()) return setError("Informe o nome / razão social.");
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return setError("E-mail inválido.");
    if (!validateCpfCnpj(cpf)) return setError("CPF/CNPJ inválido.");
    if (digits(mobilePhone).length < 10) return setError("Celular inválido (com DDD).");
    if (digits(postalCode).length !== 8) return setError("CEP inválido (8 dígitos).");
    if (!address.trim() || !addressNumber.trim() || !province.trim()) return setError("Preencha o endereço completo.");

    // Payload is fully normalized: digits-only where applicable, trimmed text.
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      cpf_cnpj: cpf,
      mobile_phone: digits(mobilePhone),
      income_value: DEFAULT_INCOME_VALUE,
      birth_date: DEFAULT_BIRTH_DATE,
      postal_code: digits(postalCode),
      address: address.trim(),
      address_number: addressNumber.trim(),
      province: province.trim(),
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
          <input style={inputStyle} value={cpfCnpj} onChange={(e) => setCpfCnpj(maskCpfCnpj(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" maxLength={18} />
        </Field>
        <Field label="Celular (com DDD)">
          <input style={inputStyle} value={mobilePhone} onChange={(e) => setMobilePhone(maskPhone(e.target.value))} placeholder="(11) 99999-9999" inputMode="numeric" maxLength={15} />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <Field label={cepLoading ? "CEP (buscando...)" : "CEP"}>
          <input style={inputStyle} value={postalCode} onChange={(e) => void onCepChange(e.target.value)} placeholder="00000-000" inputMode="numeric" maxLength={9} />
        </Field>
        <div style={{ width: 90 }}>
          <label style={labelStyle}>Número</label>
          <input style={inputStyle} value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} placeholder="123" />
        </div>
      </div>
      <Field label="Endereço">
        <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua/Av. (preenchido pelo CEP)" />
      </Field>
      <Field label="Bairro">
        <input style={inputStyle} value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Bairro (preenchido pelo CEP)" />
      </Field>

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
