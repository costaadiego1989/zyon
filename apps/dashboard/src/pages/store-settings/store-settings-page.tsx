import React, { useRef, useState } from "react";
import { Save, Instagram, Facebook, Linkedin, Youtube, MapPin, Sparkles, Upload, Trash2, Palette } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useApi } from "../../hooks/useApi.js";
import { useStoreSettingsPage, type BusinessHour, type CompanyForm, type PoliciesForm, type SocialForm, type StylesForm } from "./useStoreSettingsPage.js";
import { useSeoSettingsTab } from "./useSeoSettingsTab.js";
import { SeoGtmTab } from "./components/SeoGtmTab.js";
import { maskPhone, maskCEP, maskCNPJ } from "../../utils/masks.js";

const DAY_LABELS: Record<string, string> = {
  seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta",
  sex: "Sexta", sab: "Sábado", dom: "Domingo",
};

export function StoreSettingsPage() {
  const vm = useStoreSettingsPage();
  const { state, setCompany, setPolicies, setSocial, setBusinessHours, setStyles, setActiveTab, setLogoUrl, setBudgetMode, setBudgetEmail, setBudgetWhatsapp, handleCepChange, handleSave, generatePolicy, dismiss } = vm;
  const seoVm = useSeoSettingsTab();
  const { state: seoState, setSeo, setGtm, handleSave: handleSeoSave, handleGenerate, handleApplySuggestion, openGeneratorModal, closeGeneratorModal, toggleSection } = seoVm;

  if (state.loading || seoState.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>Carregando...</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <span className="eyebrow">LOJA</span>
          <h1 >Configurações</h1>
          <p className="page-lead">Dados da empresa, endereço, horários, políticas, redes sociais, SEO e GTM</p>
        </div>
        <Button variant="primary" size="sm" arrow onClick={state.activeTab === "seo-gtm" ? handleSeoSave : handleSave} disabled={state.saving || seoState.saving} loading={state.saving || seoState.saving}>
          <Save size={14} /> Salvar configurações
        </Button>
      </div>

      {/* Card container */}
      <TabBar
        tabs={[
          { key: "company", label: "Empresa" },
          { key: "policies", label: "Políticas" },
          { key: "social", label: "Redes Sociais" },
          { key: "seo-gtm", label: "SEO & GTM" },
          { key: "budget", label: "Orçamento" },
        ]}
        activeTab={state.activeTab as string}
        onTabChange={(k) => setActiveTab(k as any)}
      />

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginTop: 16 }}>

        {/* Content */}
        <div style={{ padding: "24px 22px", minHeight: 400 }}>
          {state.activeTab === "company" && <CompanyTab company={state.company} businessHours={state.businessHours} cepLoading={state.cepLoading} onCompanyChange={setCompany} onHoursChange={setBusinessHours} onCepChange={handleCepChange} />}
          {state.activeTab === "policies" && <PoliciesTab policies={state.policies} onChange={setPolicies} onGenerate={generatePolicy} generatingPolicy={state.generatingPolicy} />}
          {state.activeTab === "social" && <SocialTab social={state.social} onChange={setSocial} />}
          {state.activeTab === "seo-gtm" && (
            <SeoGtmTab
              seo={seoState.seo}
              gtm={seoState.gtm}
              errors={seoState.errors}
              saving={seoState.saving}
              generatingAi={seoState.generatingAi}
              showGeneratorModal={seoState.showGeneratorModal}
              suggestions={seoState.suggestions}
              expandedSections={seoState.expandedSections}
              onSeoChange={setSeo}
              onGtmChange={setGtm}
              onSave={handleSeoSave}
              onGenerate={handleGenerate}
              onApplySuggestion={handleApplySuggestion}
              onOpenModal={openGeneratorModal}
              onCloseModal={closeGeneratorModal}
              onToggleSection={toggleSection}
            />
          )}
          {state.activeTab === "budget" && (
            <div>
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
                  <FormField label="Email para orçamentos" type="email" placeholder="contato@loja.com" value={state.budgetEmail} onChange={(v) => setBudgetEmail(v)} />
                  <FormField label="WhatsApp para orçamentos" type="tel" placeholder="(11) 99999-9999" value={state.budgetWhatsapp} onChange={(v) => setBudgetWhatsapp(v)} />
                </div>
              )}
            </div>
          )}
        </div>
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
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--accent)" }}>Informações Principais</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Nome da loja" placeholder="Minha Loja" value={company.storeName} onChange={(v) => onCompanyChange({ ...company, storeName: v })} />
          <FormField label="Razão Social" placeholder="Empresa LTDA" value={company.razaoSocial} onChange={(v) => onCompanyChange({ ...company, razaoSocial: v })} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <FormField label="CNPJ" placeholder="00.000.000/0000-00" value={maskCNPJ(company.cnpj)} onChange={(v) => onCompanyChange({ ...company, cnpj: v.replace(/\D/g, "") })} />
          <FormField label="Inscrição Estadual" placeholder="000.000.000" value={company.inscricaoEstadual} onChange={(v) => onCompanyChange({ ...company, inscricaoEstadual: v })} />
          <FormField label="Email de contato" type="email" placeholder="contato@empresa.com" value={company.email} onChange={(v) => onCompanyChange({ ...company, email: v })} />
          <FormField label="Telefone" type="tel" placeholder="(11) 99999-9999" value={maskPhone(company.phone)} onChange={(v) => onCompanyChange({ ...company, phone: v.replace(/\D/g, "") })} />
        </div>
      </div>

      {/* Address */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--accent)" }}>Endereço</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
          <FormField label="CEP" placeholder="01311-100" value={maskCEP(company.zip)} onChange={(v) => { const digits = v.replace(/\D/g, ""); onCepChange(digits); }} disabled={cepLoading} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12 }}>
          <FormField label="Rua" placeholder="Av. Paulista" value={company.street} onChange={(v) => onCompanyChange({ ...company, street: v })} />
          <FormField label="Nº" placeholder="1000" value={company.number} onChange={(v) => onCompanyChange({ ...company, number: v })} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
          <FormField label="Bairro" placeholder="Centro" value={company.neighborhood} onChange={(v) => onCompanyChange({ ...company, neighborhood: v })} />
          <FormField label="Cidade" placeholder="São Paulo" value={company.city} onChange={(v) => onCompanyChange({ ...company, city: v })} />
          <FormField label="Estado" placeholder="SP" value={company.state} onChange={(v) => onCompanyChange({ ...company, state: v.toUpperCase() })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <FormField label="Complemento" placeholder="Sala 101" value={company.complement} onChange={(v) => onCompanyChange({ ...company, complement: v })} />
        </div>
      </div>

      {/* Business Hours */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--accent)" }}>Horário de Atendimento</h3>
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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ToggleSwitch
                  id={`closed-${hour.day}`}
                  checked={hour.closed}
                  disabled={false}
                  onChange={(v) => {
                    const newHours = [...businessHours];
                    newHours[idx] = { ...hour, closed: v };
                    onHoursChange(newHours);
                  }}
                />
                <span id={`closed-${hour.day}`} style={{ fontSize: 11, color: "var(--faint)" }}>Fechado</span>
              </div>
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
          <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--accent)" }}>Logotipo</h3>
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
          <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--accent)" }}>Favicon</h3>
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
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--accent)" }}>Cores</h3>
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
        <h3 style={{ font: "600 13px var(--sans)", marginBottom: 12, color: "var(--accent)" }}>Tipografia</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormSelect label="Fonte de Títulos" value={styles.fontDisplay} onChange={(v) => onChange({ ...styles, fontDisplay: v })} options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0].trim() }))} />
          <FormSelect label="Fonte de Corpo" value={styles.fontFamily} onChange={(v) => onChange({ ...styles, fontFamily: v })} options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0].trim() }))} />
        </div>
      </div>
    </div>
  );
}

