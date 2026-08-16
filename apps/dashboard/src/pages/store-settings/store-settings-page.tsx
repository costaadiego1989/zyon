import React, { useRef, useState } from "react";
import { Save, Instagram, Facebook, Linkedin, Youtube, MapPin, Sparkles, Upload, Trash2 } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { useApi } from "../../hooks/useApi.js";
import { useStoreSettingsPage, type BusinessHour, type CompanyForm, type PoliciesForm, type SocialForm } from "./useStoreSettingsPage.js";

const DAY_LABELS: Record<string, string> = {
  seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta",
  sex: "Sexta", sab: "Sábado", dom: "Domingo",
};

export function StoreSettingsPage() {
  const { state, setCompany, setPolicies, setSocial, setBusinessHours, setActiveTab, setLogoUrl, handleCepChange, handleSave, generatePolicy, dismiss } = useStoreSettingsPage();

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Carregando...</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Configurações</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Dados da empresa, endereço, horários, políticas e redes sociais.</div>
        </div>
      </div>

      {/* Card container */}
      <TabBar
        tabs={[
          { key: "company", label: "Empresa" },
          { key: "policies", label: "Políticas" },
          { key: "social", label: "Redes Sociais" },
        ]}
        activeTab={state.activeTab}
        onTabChange={(k) => setActiveTab(k as "company" | "policies" | "social")}
      />

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginTop: 16 }}>

        {/* Content */}
        <div style={{ padding: "24px 22px", minHeight: 400 }}>
          {state.activeTab === "company" && <CompanyTab company={state.company} businessHours={state.businessHours} cepLoading={state.cepLoading} onCompanyChange={setCompany} onHoursChange={setBusinessHours} onCepChange={handleCepChange} logoUrl={state.logoUrl ?? ""} onLogoChange={setLogoUrl} />}
          {state.activeTab === "policies" && <PoliciesTab policies={state.policies} onChange={setPolicies} onGenerate={generatePolicy} generatingPolicy={state.generatingPolicy} />}
          {state.activeTab === "social" && <SocialTab social={state.social} onChange={setSocial} />}
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={state.saving}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "12px 20px",
          borderRadius: 10,
          border: "none",
          background: state.saving ? "var(--good-soft)" : "var(--good)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: state.saving ? "not-allowed" : "pointer",
          opacity: state.saving ? 0.7 : 1,
          marginTop: 16,
          transition: "background 0.15s",
        }}
      >
        <Save size={16} />
        {state.saving ? "Salvando..." : "Salvar configurações"}
      </button>
    </div>
  );
}

function CompanyTab({ company, businessHours, cepLoading, onCompanyChange, onHoursChange, onCepChange, logoUrl, onLogoChange }: {
  company: CompanyForm;
  businessHours: BusinessHour[];
  cepLoading: boolean;
  onCompanyChange: (c: CompanyForm) => void;
  onHoursChange: (h: BusinessHour[]) => void;
  onCepChange: (zip: string) => void;
  logoUrl: string;
  onLogoChange: (url: string) => void;
}) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState(logoUrl);
  const [uploading, setUploading] = useState(false);

  // Sync external logoUrl into preview
  if (logoUrl && !logoPreview) setLogoPreview(logoUrl);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setLogoPreview(base64);
      try {
        const { logoUrl: url } = await api.uploadLogo(base64);
        onLogoChange(url);
        setLogoPreview(url);
      } catch {
        // fallback to base64 preview
        onLogoChange(base64);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleRemoveLogo() {
    setLogoPreview("");
    onLogoChange("");
  }

  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", fontSize: "13px", fontFamily: "var(--sans)", outline: "none", color: "var(--ink)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Logo Upload */}
      <div>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Logotipo</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--bg)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Upload size={20} style={{ color: "var(--faint)" }} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoUpload} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", font: "600 12px var(--sans)", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1 }}
            >
              <Upload size={13} />
              {uploading ? "Enviando..." : "Alterar logo"}
            </button>
            {logoPreview && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", font: "600 11px var(--sans)", cursor: "pointer" }}
              >
                <Trash2 size={11} /> Remover
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Company Info */}
      <div>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Informações Principais</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>CNPJ</span>
            <input style={fieldStyle} placeholder="00.000.000/0000-00" value={company.cnpj} onChange={(e) => onCompanyChange({ ...company, cnpj: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Razão Social</span>
            <input style={fieldStyle} placeholder="Empresa LTDA" value={company.razaoSocial} onChange={(e) => onCompanyChange({ ...company, razaoSocial: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Inscrição Estadual</span>
            <input style={fieldStyle} placeholder="000.000.000" value={company.inscricaoEstadual} onChange={(e) => onCompanyChange({ ...company, inscricaoEstadual: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Email de contato</span>
            <input style={fieldStyle} type="email" placeholder="contato@empresa.com" value={company.email} onChange={(e) => onCompanyChange({ ...company, email: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Telefone</span>
            <input style={fieldStyle} placeholder="(11) 99999-9999" value={company.phone} onChange={(e) => onCompanyChange({ ...company, phone: e.target.value })} />
          </label>
        </div>
      </div>

      {/* Address */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Endereço</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>CEP</span>
            <input style={{ ...fieldStyle, opacity: cepLoading ? 0.6 : 1 }} placeholder="01311-100" value={company.zip} onChange={(e) => onCepChange(e.target.value)} disabled={cepLoading} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Rua</span>
            <input style={fieldStyle} placeholder="Av. Paulista" value={company.street} onChange={(e) => onCompanyChange({ ...company, street: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Nº</span>
            <input style={fieldStyle} placeholder="1000" value={company.number} onChange={(e) => onCompanyChange({ ...company, number: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Bairro</span>
            <input style={fieldStyle} placeholder="Centro" value={company.neighborhood} onChange={(e) => onCompanyChange({ ...company, neighborhood: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Cidade</span>
            <input style={fieldStyle} placeholder="São Paulo" value={company.city} onChange={(e) => onCompanyChange({ ...company, city: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Estado</span>
            <input style={fieldStyle} placeholder="SP" maxLength={2} value={company.state} onChange={(e) => onCompanyChange({ ...company, state: e.target.value.toUpperCase() })} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Complemento</span>
            <input style={fieldStyle} placeholder="Sala 101" value={company.complement} onChange={(e) => onCompanyChange({ ...company, complement: e.target.value })} />
          </label>
        </div>
      </div>

      {/* Business Hours */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Horário de Atendimento</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {businessHours.map((hour, idx) => (
            <div key={hour.day} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 80px", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ink)" }}>{DAY_LABELS[hour.day]}</span>
              <input type="time" value={hour.closed ? "" : hour.startTime} onChange={(e) => {
                const newHours = [...businessHours];
                newHours[idx] = { ...hour, startTime: e.target.value, closed: false };
                onHoursChange(newHours);
              }} disabled={hour.closed} style={{ ...fieldStyle, opacity: hour.closed ? 0.5 : 1 }} />
              <input type="time" value={hour.closed ? "" : hour.endTime} onChange={(e) => {
                const newHours = [...businessHours];
                newHours[idx] = { ...hour, endTime: e.target.value, closed: false };
                onHoursChange(newHours);
              }} disabled={hour.closed} style={{ ...fieldStyle, opacity: hour.closed ? 0.5 : 1 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={hour.closed} onChange={(e) => {
                  const newHours = [...businessHours];
                  newHours[idx] = { ...hour, closed: e.target.checked };
                  onHoursChange(newHours);
                }} />
                <span style={{ fontSize: 11, color: "var(--faint)" }}>Fechado</span>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PoliciesTab({ policies, onChange, onGenerate, generatingPolicy }: {
  policies: PoliciesForm;
  onChange: (p: PoliciesForm) => void;
  onGenerate: (type: "privacy" | "returns" | "terms" | "shipping") => void;
  generatingPolicy: string | null;
}) {
  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", fontSize: "13px", outline: "none", fontFamily: "inherit", resize: "vertical", color: "var(--ink)" };

  const fields: Array<{ key: "privacy" | "returns" | "terms" | "shipping"; label: string }> = [
    { key: "privacy", label: "Política de Privacidade" },
    { key: "returns", label: "Política de Devolução e Trocas" },
    { key: "terms", label: "Termos de Uso" },
    { key: "shipping", label: "Política de Envio e Frete" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {fields.map(({ key, label }) => (
        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>{label}</span>
            <button
              type="button"
              onClick={() => onGenerate(key)}
              disabled={generatingPolicy !== null}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--card)",
                font: "500 11px var(--sans)",
                color: generatingPolicy === key ? "var(--good)" : "var(--muted)",
                cursor: generatingPolicy !== null ? "not-allowed" : "pointer",
                opacity: generatingPolicy !== null && generatingPolicy !== key ? 0.5 : 1,
              }}
            >
              <Sparkles size={12} />
              {generatingPolicy === key ? "Gerando..." : "Gerar com IA"}
            </button>
          </div>
          <textarea style={{ ...fieldStyle, minHeight: 80 }} placeholder={`URL ou texto da ${label.toLowerCase()}`} value={policies[key]} onChange={(e) => onChange({ ...policies, [key]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function SocialTab({ social, onChange }: {
  social: SocialForm;
  onChange: (s: SocialForm) => void;
}) {
  const fieldStyle: React.CSSProperties = { flex: 1, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", fontSize: "13px", outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Instagram size={18} style={{ color: "var(--good)", flex: "none" }} />
        <input placeholder="https://instagram.com/sua-loja" value={social.instagram} onChange={(e) => onChange({ ...social, instagram: e.target.value })} style={fieldStyle} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Facebook size={18} style={{ color: "var(--good)", flex: "none" }} />
        <input placeholder="https://facebook.com/sua-loja" value={social.facebook} onChange={(e) => onChange({ ...social, facebook: e.target.value })} style={fieldStyle} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Linkedin size={18} style={{ color: "var(--good)", flex: "none" }} />
        <input placeholder="https://linkedin.com/company/sua-empresa" value={social.linkedin} onChange={(e) => onChange({ ...social, linkedin: e.target.value })} style={fieldStyle} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Youtube size={18} style={{ color: "var(--good)", flex: "none" }} />
        <input placeholder="https://youtube.com/@seu-canal" value={social.youtube} onChange={(e) => onChange({ ...social, youtube: e.target.value })} style={fieldStyle} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MapPin size={18} style={{ color: "var(--good)", flex: "none" }} />
        <input placeholder="https://maps.google.com/..." value={social.googleMaps} onChange={(e) => onChange({ ...social, googleMaps: e.target.value })} style={fieldStyle} />
      </label>
    </div>
  );
}

