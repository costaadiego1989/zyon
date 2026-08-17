import React, { useRef, useState } from "react";
import { Save, Instagram, Facebook, Linkedin, Youtube, MapPin, Sparkles, Upload, Trash2, Palette } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
import { useApi } from "../../hooks/useApi.js";
import { useStoreSettingsPage, type BusinessHour, type CompanyForm, type PoliciesForm, type SocialForm, type StylesForm } from "./useStoreSettingsPage.js";
import { maskPhone, maskCEP, maskCNPJ } from "../../utils/masks.js";

const DAY_LABELS: Record<string, string> = {
  seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta",
  sex: "Sexta", sab: "Sábado", dom: "Domingo",
};

export function StoreSettingsPage() {
  const vm = useStoreSettingsPage();
  const { state, setCompany, setPolicies, setSocial, setBusinessHours, setStyles, setActiveTab, setLogoUrl, setBudgetMode, setBudgetEmail, setBudgetWhatsapp, handleCepChange, handleSave, generatePolicy, dismiss } = vm;

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Carregando...</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Configurações</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Dados da empresa, endereço, horários, políticas e redes sociais.</div>
        </div>
        <Button variant="primary" size="sm" arrow onClick={handleSave} disabled={state.saving} loading={state.saving}>
          <Save size={14} /> Salvar configurações
        </Button>
      </div>

      {/* Card container */}
      <TabBar
        tabs={[
          { key: "company", label: "Empresa" },
          { key: "policies", label: "Políticas" },
          { key: "social", label: "Redes Sociais" },
          { key: "styles", label: "Estilos" },
        ]}
        activeTab={state.activeTab}
        onTabChange={(k) => setActiveTab(k as "company" | "policies" | "social" | "styles")}
      />

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginTop: 16 }}>

        {/* Content */}
        <div style={{ padding: "24px 22px", minHeight: 400 }}>
          {state.activeTab === "company" && <CompanyTab company={state.company} businessHours={state.businessHours} cepLoading={state.cepLoading} onCompanyChange={setCompany} onHoursChange={setBusinessHours} onCepChange={handleCepChange} />}
          {state.activeTab === "policies" && <PoliciesTab policies={state.policies} onChange={setPolicies} onGenerate={generatePolicy} generatingPolicy={state.generatingPolicy} />}
          {state.activeTab === "social" && <SocialTab social={state.social} onChange={setSocial} />}
          {state.activeTab === "styles" && <StylesTab styles={state.styles} onChange={setStyles} />}
        </div>
      </div>

      {/* Modo Orçamento */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginTop: 20 }}>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Modo Orçamento</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 16px", lineHeight: 1.5 }}>
          Quando ativado, clientes solicitam orçamento ao invés de finalizar compra. Você recebe por email e WhatsApp.
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
          <div>
            <strong style={{ fontSize: 13, color: "var(--ink)" }}>Ativar modo orçamento</strong>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>Substitui &quot;Finalizar pedido&quot; por &quot;Solicitar orçamento&quot;</p>
          </div>
          <label style={{ position: "relative", width: 42, height: 24, cursor: "pointer" }}>
            <input type="checkbox" checked={state.budgetMode} onChange={(e) => setBudgetMode(e.target.checked)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
            <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: state.budgetMode ? "var(--accent, #0f766e)" : "var(--border)", transition: "background 0.2s" }}>
              <span style={{ position: "absolute", top: 2, left: state.budgetMode ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </span>
          </label>
        </div>
        {state.budgetMode && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Email para orçamentos</span>
              <input type="email" value={state.budgetEmail} onChange={(e) => setBudgetEmail(e.target.value)} placeholder="contato@loja.com" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>WhatsApp para orçamentos</span>
              <input type="tel" value={state.budgetWhatsapp} onChange={(e) => setBudgetWhatsapp(e.target.value)} placeholder="(11) 99999-9999" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }} />
            </label>
          </div>
        )}
      </div>

    </div>
  );
}

function CompanyTab({ company, businessHours, cepLoading, onCompanyChange, onHoursChange, onCepChange }: {
  company: CompanyForm;
  businessHours: BusinessHour[];
  cepLoading: boolean;
  onCompanyChange: (c: CompanyForm) => void;
  onHoursChange: (h: BusinessHour[]) => void;
  onCepChange: (zip: string) => void;
}) {
  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", fontSize: "13px", fontFamily: "var(--sans)", outline: "none", color: "var(--ink)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Company Info */}
      <div>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Informações Principais</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Nome da loja</span>
            <input style={fieldStyle} placeholder="Minha Loja" value={company.storeName} onChange={(e) => onCompanyChange({ ...company, storeName: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Razão Social</span>
            <input style={fieldStyle} placeholder="Empresa LTDA" value={company.razaoSocial} onChange={(e) => onCompanyChange({ ...company, razaoSocial: e.target.value })} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>CNPJ</span>
            <input style={fieldStyle} placeholder="00.000.000/0000-00" value={maskCNPJ(company.cnpj)} onChange={(e) => onCompanyChange({ ...company, cnpj: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Inscrição Estadual</span>
            <input style={fieldStyle} placeholder="000.000.000" value={company.inscricaoEstadual} onChange={(e) => onCompanyChange({ ...company, inscricaoEstadual: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Email de contato</span>
            <input style={fieldStyle} type="email" placeholder="contato@empresa.com" value={company.email} onChange={(e) => onCompanyChange({ ...company, email: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Telefone</span>
            <input style={fieldStyle} placeholder="(11) 99999-9999" value={maskPhone(company.phone)} onChange={(e) => onCompanyChange({ ...company, phone: e.target.value.replace(/\D/g, "") })} />
          </label>
        </div>
      </div>

      {/* Address */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>Endereço</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>CEP</span>
            <input style={{ ...fieldStyle, opacity: cepLoading ? 0.6 : 1 }} placeholder="01311-100" value={maskCEP(company.zip)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); onCepChange(digits); }} disabled={cepLoading} />
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

function StylesTab({ styles, onChange }: {
  styles: StylesForm;
  onChange: (s: StylesForm) => void;
}) {
  const api = useApi();
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState(styles.logoUrl);
  const [faviconPreview, setFaviconPreview] = useState(styles.faviconUrl);
  const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null);

  if (styles.logoUrl && !logoPreview) setLogoPreview(styles.logoUrl);
  if (styles.faviconUrl && !faviconPreview) setFaviconPreview(styles.faviconUrl);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, type: "logo" | "favicon") {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(type);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      if (type === "logo") {
        setLogoPreview(base64);
        try {
          const { logoUrl: url } = await api.uploadLogo(base64);
          onChange({ ...styles, logoUrl: url });
          setLogoPreview(url);
        } catch {
          onChange({ ...styles, logoUrl: base64 });
        }
      } else {
        setFaviconPreview(base64);
        onChange({ ...styles, faviconUrl: base64 });
      }
      setUploading(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", fontSize: "13px", outline: "none", color: "var(--ink)" };

  const FONT_OPTIONS = [
    "Inter, ui-sans-serif, system-ui, sans-serif",
    "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
    "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
    "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
    "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
    "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
    "Poppins, Inter, ui-sans-serif, system-ui, sans-serif",
    "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Logo + Favicon side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Logo */}
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
              <input ref={logoFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e, "logo")} />
              <button
                type="button"
                onClick={() => logoFileRef.current?.click()}
                disabled={uploading !== null}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", font: "600 12px var(--sans)", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1 }}
              >
                <Upload size={13} />
                {uploading === "logo" ? "Enviando..." : "Alterar logo"}
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoPreview(""); onChange({ ...styles, logoUrl: "" }); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", font: "600 11px var(--sans)", cursor: "pointer" }}
                >
                  <Trash2 size={11} /> Remover
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Favicon */}
        <div>
          <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Favicon</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {faviconPreview ? (
                <img src={faviconPreview} alt="Favicon" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Palette size={18} style={{ color: "var(--faint)" }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input ref={faviconFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e, "favicon")} />
              <button
                type="button"
                onClick={() => faviconFileRef.current?.click()}
                disabled={uploading !== null}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", font: "600 12px var(--sans)", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1 }}
              >
                <Upload size={13} />
                {uploading === "favicon" ? "Enviando..." : "Alterar favicon"}
              </button>
              {faviconPreview && (
                <button
                  type="button"
                  onClick={() => { setFaviconPreview(""); onChange({ ...styles, faviconUrl: "" }); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", font: "600 11px var(--sans)", cursor: "pointer" }}
                >
                  <Trash2 size={11} /> Remover
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Colors */}
      <div>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Cores</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Cor Primária</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="color" value={styles.accentColor} onChange={(e) => onChange({ ...styles, accentColor: e.target.value })} style={{ width: 50, height: 38, borderRadius: 7, border: "1px solid var(--border)", cursor: "pointer" }} />
              <input style={{ ...fieldStyle, fontFamily: "var(--mono)", fontSize: 12 }} placeholder="#000000" value={styles.accentColor} onChange={(e) => onChange({ ...styles, accentColor: e.target.value })} />
            </div>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Cor Secundária</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="color" value={styles.secondaryColor} onChange={(e) => onChange({ ...styles, secondaryColor: e.target.value })} style={{ width: 50, height: 38, borderRadius: 7, border: "1px solid var(--border)", cursor: "pointer" }} />
              <input style={{ ...fieldStyle, fontFamily: "var(--mono)", fontSize: 12 }} placeholder="#666666" value={styles.secondaryColor} onChange={(e) => onChange({ ...styles, secondaryColor: e.target.value })} />
            </div>
          </label>
        </div>
      </div>

      {/* Fonts */}
      <div>
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--ink)" }}>Tipografia</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Fonte de Títulos</span>
            <select style={{ ...fieldStyle, cursor: "pointer" }} value={styles.fontDisplay} onChange={(e) => onChange({ ...styles, fontDisplay: e.target.value })}>
              {FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font.split(",")[0].trim()}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)" }}>Fonte de Corpo</span>
            <select style={{ ...fieldStyle, cursor: "pointer" }} value={styles.fontFamily} onChange={(e) => onChange({ ...styles, fontFamily: e.target.value })}>
              {FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font.split(",")[0].trim()}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

