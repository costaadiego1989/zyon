import { EmptyState } from "../../components/EmptyState.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import "../administration-pages.css";
import "./store-settings.css";
import { PageHeader } from "../../components/PageHeader.js";
import React, { useRef, useState } from "react";
import { Save, Instagram, Facebook, Linkedin, Youtube, MapPin, Sparkles, Upload, Trash2, Palette, Settings } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { useStoreSettingsPage, type BusinessHour, type CompanyForm, type PoliciesForm, type SocialForm, type StylesForm } from "./useStoreSettingsPage.js";
import { useSeoSettingsTab } from "./useSeoSettingsTab.js";
import { SeoGtmTab } from "./components/SeoGtmTab.js";
import { BudgetRequests } from "./components/BudgetRequests.js";
import { maskPhone, maskCEP, maskCNPJ } from "../../utils/masks.js";
import { formatBudgetPhone } from "./budget-phone.js";

const DAY_LABELS: Record<string, string> = {
  seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta",
  sex: "Sexta", sab: "Sábado", dom: "Domingo",
};

export function StoreSettingsPage() {
  const vm = useStoreSettingsPage();
  const { state, setCompany, setPolicies, setSocial, setBusinessHours, setStyles, setActiveTab, setLogoUrl, setBudgetMode, setBudgetEmail, setBudgetWhatsapp, handleCepChange, handleSave, generatePolicy, dismiss } = vm;
  const seoVm = useSeoSettingsTab();
  const { state: seoState, setSeo, setGtm, setSlug, handleSave: handleSeoSave, handleGenerate, handleApplySuggestion, openGeneratorModal, closeGeneratorModal, toggleSection } = seoVm;

  const busy = state.saving || seoState.saving || !!state.generatingPolicy || seoState.generatingAi;
  if (state.loading) return <div className="administration-page"><PageHeader title="Configurações da loja" description="Organize os dados e as informações que seus clientes consultam." /><section className="panel admin-skeleton" aria-label="Carregando configurações" aria-busy="true">{[1,2,3].map(n => <div className="skeleton-cell" key={n} />)}</section></div>;
  if (state.loadError) return <div><PageHeader title="Configurações da loja" /><section className="panel"><EmptyState icon={Settings} title="Configurações indisponíveis" description="Não foi possível carregar os dados atuais. Tente novamente antes de editar." action={<Button variant="outline" onClick={vm.reload}>Tentar novamente</Button>} /></section></div>;

  return (
    <div className="page-container administration-page store-settings-page">
      <PageHeader title="Configurações da loja" description="Organize os dados e as informações que seus clientes consultam." actions={<>
<Button variant="primary" size="sm" arrow onClick={state.activeTab === "seo-gtm" ? handleSeoSave : handleSave} disabled={busy || (state.activeTab === "budget" && !state.budgetAvailable) || (state.activeTab === "seo-gtm" && (seoState.loading || !!seoState.loadError))} loading={state.saving || seoState.saving}>
          <Save size={14} /> Salvar configurações
        </Button>
</>} />

      {/* Card container */}
      <TabBar
        tabs={[
          { key: "company", label: "Empresa" },
          { key: "policies", label: "Políticas" },
          { key: "social", label: "Redes sociais" },
          { key: "seo-gtm", label: "Busca e rastreamento" },
          { key: "budget", label: "Orçamento" },
        ]}
        activeTab={state.activeTab as string}
        onTabChange={(k) => { if (!busy) setActiveTab(k as typeof state.activeTab); }}
      />

      {(state.activeTab === "seo-gtm" ? seoState.actionError : state.saveError) && <p role="alert" className="admin-feedback admin-feedback--error">{state.activeTab === "seo-gtm" ? seoState.actionError : state.saveError}</p>}
      {(state.activeTab === "seo-gtm" ? seoState.saveMessage : state.saveResult === "success") && <p role="status" className="admin-feedback admin-feedback--ok">{state.activeTab === "seo-gtm" ? seoState.saveMessage : state.activeTab === "budget" ? "Configurações de orçamento salvas." : "Dados da loja salvos."}</p>}
      <div className="panel configuration-form store-settings-content">

        {/* Content */}
        <fieldset className="store-settings-fieldset" disabled={busy}>
          {state.activeTab === "company" && <CompanyTab company={state.company} businessHours={state.businessHours} cepLoading={state.cepLoading} onCompanyChange={setCompany} onHoursChange={setBusinessHours} onCepChange={handleCepChange} />}
          {state.activeTab === "policies" && <PoliciesTab policies={state.policies} onChange={setPolicies} onGenerate={generatePolicy} generatingPolicy={state.generatingPolicy} />}
          {state.activeTab === "social" && <SocialTab social={state.social} onChange={setSocial} />}
          {state.activeTab === "seo-gtm" && (seoState.loading ? <div className="admin-skeleton" aria-label="Carregando busca e rastreamento" aria-busy="true"><div className="skeleton-cell" /></div> : seoState.loadError ? <EmptyState icon={Settings} title="Busca e rastreamento indisponíveis" description="Não foi possível carregar estas configurações. Os dados das outras abas continuam disponíveis." action={<Button variant="outline" onClick={seoVm.reload}>Tentar novamente</Button>} /> :
            <SeoGtmTab
              actionError={seoState.actionError}
              seo={seoState.seo}
              gtm={seoState.gtm}
              slug={seoState.slug}
              errors={seoState.errors}
              saving={seoState.saving}
              generatingAi={seoState.generatingAi}
              showGeneratorModal={seoState.showGeneratorModal}
              suggestions={seoState.suggestions}
              expandedSections={seoState.expandedSections}
              onSeoChange={setSeo}
              onGtmChange={setGtm}
              onSlugChange={setSlug}
              onSave={handleSeoSave}
              onGenerate={handleGenerate}
              onApplySuggestion={handleApplySuggestion}
              onOpenModal={openGeneratorModal}
              onCloseModal={closeGeneratorModal}
              onToggleSection={toggleSection}
            />
          )}
          {state.activeTab === "budget" && (state.budgetAvailable ? (
            <div className="store-budget">
              <p className="admin-help">Receba solicitações para negociar com o comprador antes do pagamento. Salve as configurações para aplicar a mudança à loja.</p>
              <div className="store-budget__activation">
                <div><label id="budget-mode-label" htmlFor="budget-mode">Ativar modo orçamento</label><p id="budget-mode-help">O comprador solicita uma proposta em vez de finalizar o pagamento.</p></div>
                <ToggleSwitch id="budget-mode" checked={state.budgetMode} disabled={busy} onChange={setBudgetMode} aria-labelledby="budget-mode-label" aria-describedby="budget-mode-help" />
              </div>
              <div>
                <SectionHeader title="Contatos para os avisos" subtitle="Informe os destinos de e-mail e WhatsApp. O envio depende da configuração dos canais da loja." variant="secondary" />
                <div className="admin-fields">
                  <FormField label="E-mail para orçamentos" type="email" placeholder="contato@loja.com" value={state.budgetEmail} onChange={setBudgetEmail} maxLength={254} hint="Opcional." error={state.budgetErrors.email} inputProps={{ autoComplete: "email" }} />
                  <FormField label="WhatsApp para orçamentos" type="tel" placeholder="(11) 99999-9999" value={formatBudgetPhone(state.budgetWhatsapp)} onChange={value => setBudgetWhatsapp(formatBudgetPhone(value))} maxLength={32} hint="Opcional. Inclua o DDD. Para outro país, comece com + e o código do país." error={state.budgetErrors.whatsapp} inputProps={{ autoComplete: "tel", inputMode: "tel" }} />
                </div>
              </div>
            </div>
          ) : <EmptyState icon={Settings} title="Orçamento indisponível" description="Não foi possível consultar a configuração atual de orçamento. Tente novamente antes de editar." action={<Button variant="outline" onClick={vm.reload}>Tentar novamente</Button>} />)}
        </fieldset>
        {state.activeTab === "budget" && <BudgetRequests />}
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
  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-1)", fontSize: "13px", fontFamily: "var(--font-sans)", outline: "none", color: "var(--color-text)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Company Info */}
      <div>
        <SectionHeader title="Dados da empresa" variant="secondary" />
        <div className="admin-fields">
          <FormField label="Nome da loja" placeholder="Minha Loja" value={company.storeName} onChange={(v) => onCompanyChange({ ...company, storeName: v })} />
          <FormField label="Razão social" placeholder="Empresa LTDA" value={company.razaoSocial} onChange={(v) => onCompanyChange({ ...company, razaoSocial: v })} />
        </div>
        <div className="admin-fields" style={{ marginTop: 24 }}>
          <FormField label="CNPJ" placeholder="00.000.000/0000-00" value={maskCNPJ(company.cnpj)} onChange={(v) => onCompanyChange({ ...company, cnpj: v.replace(/\D/g, "") })} />
          <FormField label="Inscrição estadual" placeholder="000.000.000" value={company.inscricaoEstadual} onChange={(v) => onCompanyChange({ ...company, inscricaoEstadual: v })} />
          <FormField label="E-mail de contato" type="email" placeholder="contato@empresa.com" value={company.email} onChange={(v) => onCompanyChange({ ...company, email: v })} />
          <FormField label="Telefone" type="tel" placeholder="(11) 99999-9999" value={maskPhone(company.phone)} onChange={(v) => onCompanyChange({ ...company, phone: v.replace(/\D/g, "") })} />
        </div>
      </div>

      {/* Address */}
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
        <SectionHeader title="Endereço" variant="secondary" />
        <div className="admin-fields" style={{ marginBottom: 24 }}>
          <FormField label="CEP" placeholder="01311-100" value={maskCEP(company.zip)} onChange={(v) => { const digits = v.replace(/\D/g, ""); onCepChange(digits); }} disabled={cepLoading} />
        </div>
        <div className="admin-fields">
          <FormField label="Rua" placeholder="Av. Paulista" value={company.street} onChange={(v) => onCompanyChange({ ...company, street: v })} />
          <FormField label="Número" placeholder="1000" value={company.number} onChange={(v) => onCompanyChange({ ...company, number: v })} />
        </div>
        <div className="admin-fields" style={{ marginTop: 24 }}>
          <FormField label="Bairro" placeholder="Centro" value={company.neighborhood} onChange={(v) => onCompanyChange({ ...company, neighborhood: v })} />
          <FormField label="Cidade" placeholder="São Paulo" value={company.city} onChange={(v) => onCompanyChange({ ...company, city: v })} />
          <FormField label="Estado" placeholder="SP" value={company.state} onChange={(v) => onCompanyChange({ ...company, state: v.toUpperCase() })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <FormField label="Complemento" placeholder="Sala 101" value={company.complement} onChange={(v) => onCompanyChange({ ...company, complement: v })} />
        </div>
      </div>

      {/* Business Hours */}
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
        <SectionHeader title="Horários de atendimento" variant="secondary" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {businessHours.map((hour, idx) => (
            <div key={hour.day} className="store-hour-row">
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text)" }}>{DAY_LABELS[hour.day]}</span>
              <input aria-label={`Abertura na ${DAY_LABELS[hour.day].toLowerCase()}`} type="time" value={hour.closed ? "" : hour.startTime} onChange={(e) => {
                const newHours = [...businessHours];
                newHours[idx] = { ...hour, startTime: e.target.value, closed: false };
                onHoursChange(newHours);
              }} disabled={hour.closed} style={{ ...fieldStyle, opacity: hour.closed ? 0.5 : 1 }} />
              <input aria-label={`Fechamento na ${DAY_LABELS[hour.day].toLowerCase()}`} type="time" value={hour.closed ? "" : hour.endTime} onChange={(e) => {
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
                <label htmlFor={`closed-${hour.day}`}>Fechado</label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PoliciesTab({ policies, onChange, onGenerate, generatingPolicy }: { policies: PoliciesForm; onChange: (p: PoliciesForm) => void; onGenerate: (type: keyof PoliciesForm) => void; generatingPolicy: string | null }) {
  const fields: Array<{ key: keyof PoliciesForm; label: string }> = [{ key: "privacy", label: "Política de privacidade" }, { key: "returns", label: "Trocas e devoluções" }, { key: "terms", label: "Termos de uso" }, { key: "shipping", label: "Envio e frete" }];
  return <div className="store-policy-list">
    <div className="store-policy-help">
    <p className="admin-help">Estas são as políticas da sua loja. Depois de salvar, elas ficam disponíveis aos compradores e à IA. Deixe o campo vazio e salve para remover uma política. Trocas e envio também atualizam os mesmos campos da base de conhecimento.</p>
    <p className="admin-help">A IA prepara um rascunho. Confira razão social, CNPJ, endereço, contato e condições comerciais antes de publicar; o texto gerado precisa de revisão.</p>
    <p className="admin-help">Os documentos da plataforma complementam as políticas da loja: <a href="https://www.zyon-payments.com.br/privacidade" target="_blank" rel="noreferrer">Privacidade da Zyon</a> · <a href="https://www.zyon-payments.com.br/termos" target="_blank" rel="noreferrer">Termos da Zyon</a> · <a href="https://www.zyon-payments.com.br/cookies" target="_blank" rel="noreferrer">Cookies</a>.</p>
    </div>
    {fields.map(({key,label}) => <section key={key}><FormTextarea label={label} value={policies[key]} onChange={v => onChange({ ...policies, [key]: v })} placeholder="Informe o texto ou o endereço da política" rows={6} /><div className="admin-actions"><Button aria-label={`Gerar rascunho de ${label.toLowerCase()}`} variant="outline" disabled={generatingPolicy !== null} loading={generatingPolicy === key} onClick={() => onGenerate(key)}><Sparkles size={16} /> Gerar rascunho</Button></div></section>)}
  </div>;
}

function SocialTab({ social, onChange }: { social: SocialForm; onChange: (s: SocialForm) => void }) {
  const fields: Array<{key:keyof SocialForm;label:string;placeholder:string}> = [{key:"instagram",label:"Instagram",placeholder:"https://instagram.com/sua-loja"},{key:"facebook",label:"Facebook",placeholder:"https://facebook.com/sua-loja"},{key:"linkedin",label:"LinkedIn",placeholder:"https://linkedin.com/company/sua-empresa"},{key:"youtube",label:"YouTube",placeholder:"https://youtube.com/@seu-canal"},{key:"googleMaps",label:"Localização no Google Maps",placeholder:"https://maps.google.com/..."}];
  return <div><SectionHeader title="Canais da loja" variant="secondary" /><p className="admin-help">Adicione os links completos dos canais que seus clientes podem visitar. Preencha apenas os que a loja utiliza.</p><div className="admin-fields">{fields.map(({key,label,placeholder}) => <FormField key={key} label={label} type="url" placeholder={placeholder} value={social[key]} onChange={v => onChange({ ...social, [key]: v })} />)}</div></div>;
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
        } catch (e) {
          reportError({ source: "store-settings.handleImageUpload.logo", error: e, context: { type } });
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

  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-1)", fontSize: "13px", outline: "none", color: "var(--color-text)" };

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
          <SectionHeader title="Logotipo" variant="secondary" />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--color-border)", background: "var(--surface-1)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Upload size={20} style={{ color: "var(--color-text-faint)" }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input ref={logoFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e, "logo")} />
              <button
                type="button"
                onClick={() => logoFileRef.current?.click()}
                disabled={uploading !== null}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "600 12px var(--font-sans)", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1 }}
              >
                <Upload size={13} />
                {uploading === "logo" ? "Enviando..." : "Alterar logo"}
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoPreview(""); onChange({ ...styles, logoUrl: "" }); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", font: "600 11px var(--font-sans)", cursor: "pointer" }}
                >
                  <Trash2 size={11} /> Remover
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Favicon */}
        <div>
          <SectionHeader title="Favicon" variant="secondary" />
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-1)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {faviconPreview ? (
                <img src={faviconPreview} alt="Favicon" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Palette size={18} style={{ color: "var(--color-text-faint)" }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input ref={faviconFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(e, "favicon")} />
              <button
                type="button"
                onClick={() => faviconFileRef.current?.click()}
                disabled={uploading !== null}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "600 12px var(--font-sans)", cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1 }}
              >
                <Upload size={13} />
                {uploading === "favicon" ? "Enviando..." : "Alterar favicon"}
              </button>
              {faviconPreview && (
                <button
                  type="button"
                  onClick={() => { setFaviconPreview(""); onChange({ ...styles, faviconUrl: "" }); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", font: "600 11px var(--font-sans)", cursor: "pointer" }}
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
        <SectionHeader title="Cores" variant="secondary" />
        <div className="admin-fields">
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-faint)" }}>Cor Primária</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="color" value={styles.accentColor} onChange={(e) => onChange({ ...styles, accentColor: e.target.value })} style={{ width: 50, height: 38, borderRadius: 7, border: "1px solid var(--color-border)", cursor: "pointer" }} />
              <input style={{ ...fieldStyle, fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="#000000" value={styles.accentColor} onChange={(e) => onChange({ ...styles, accentColor: e.target.value })} />
            </div>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-faint)" }}>Cor Secundária</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="color" value={styles.secondaryColor} onChange={(e) => onChange({ ...styles, secondaryColor: e.target.value })} style={{ width: 50, height: 38, borderRadius: 7, border: "1px solid var(--color-border)", cursor: "pointer" }} />
              <input style={{ ...fieldStyle, fontFamily: "var(--font-mono)", fontSize: 12 }} placeholder="#666666" value={styles.secondaryColor} onChange={(e) => onChange({ ...styles, secondaryColor: e.target.value })} />
            </div>
          </label>
        </div>
      </div>

      {/* Fonts */}
      <div>
        <SectionHeader title="Tipografia" variant="secondary" />
        <div className="admin-fields">
          <FormSelect label="Fonte de Títulos" value={styles.fontDisplay} onChange={(v) => onChange({ ...styles, fontDisplay: v })} options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0].trim() }))} />
          <FormSelect label="Fonte de Corpo" value={styles.fontFamily} onChange={(v) => onChange({ ...styles, fontFamily: v })} options={FONT_OPTIONS.map((font) => ({ value: font, label: font.split(",")[0].trim() }))} />
        </div>
      </div>
    </div>
  );
}
