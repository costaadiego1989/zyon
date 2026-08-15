import React, { useEffect, useState } from "react";
import { Save, Instagram, Facebook, Linkedin, Youtube, MapPin } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { DashboardHttpError } from "../api/http/index.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";

export interface StoreSettingsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

interface SocialForm {
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
  googleMaps: string;
}

interface CompanyForm {
  cnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  email: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  businessHours: string;
}

interface PoliciesForm {
  privacy: string;
  returns: string;
  terms: string;
  shipping: string;
}

const EMPTY_SOCIAL: SocialForm = { instagram: "", facebook: "", linkedin: "", youtube: "", googleMaps: "" };
const EMPTY_COMPANY: CompanyForm = { cnpj: "", razaoSocial: "", inscricaoEstadual: "", email: "", phone: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", zip: "", businessHours: "" };
const EMPTY_POLICIES: PoliciesForm = { privacy: "", returns: "", terms: "", shipping: "" };

export function StoreSettingsPage(_props: StoreSettingsPageProps) {
  const api = useApi();

  const [social, setSocial] = useState<SocialForm>(EMPTY_SOCIAL);
  const [company, setCompany] = useState<CompanyForm>(EMPTY_COMPANY);
  const [policies, setPolicies] = useState<PoliciesForm>(EMPTY_POLICIES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"social" | "company" | "policies">("social");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await api.getStoreSettings() as Record<string, any>;
        if (cancelled) return;
        if (settings?.social) {
          setSocial({ ...EMPTY_SOCIAL, ...settings.social });
        }
        if (settings?.company) {
          const c = settings.company;
          setCompany({
            cnpj: c.cnpj ?? "",
            razaoSocial: c.razaoSocial ?? "",
            inscricaoEstadual: c.inscricaoEstadual ?? "",
            email: c.email ?? "",
            phone: c.phone ?? "",
            street: c.address?.street ?? "",
            number: c.address?.number ?? "",
            complement: c.address?.complement ?? "",
            neighborhood: c.address?.neighborhood ?? "",
            city: c.address?.city ?? "",
            state: c.address?.state ?? "",
            zip: c.address?.zip ?? "",
            businessHours: c.businessHours ?? "",
          });
        }
        if (settings?.policies) {
          setPolicies({ ...EMPTY_POLICIES, ...settings.policies });
        }
      } catch {
        // first time — no settings yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const payload = {
        social: {
          ...(social.instagram && { instagram: social.instagram }),
          ...(social.facebook && { facebook: social.facebook }),
          ...(social.linkedin && { linkedin: social.linkedin }),
          ...(social.youtube && { youtube: social.youtube }),
          ...(social.googleMaps && { googleMaps: social.googleMaps }),
        },
        company: {
          ...(company.cnpj && { cnpj: company.cnpj }),
          ...(company.razaoSocial && { razaoSocial: company.razaoSocial }),
          ...(company.inscricaoEstadual && { inscricaoEstadual: company.inscricaoEstadual }),
          ...(company.email && { email: company.email }),
          ...(company.phone && { phone: company.phone }),
          ...(company.businessHours && { businessHours: company.businessHours }),
          address: {
            street: company.street,
            number: company.number,
            complement: company.complement,
            neighborhood: company.neighborhood,
            city: company.city,
            state: company.state,
            zip: company.zip,
          },
        },
        policies: {
          ...(policies.privacy && { privacy: policies.privacy }),
          ...(policies.returns && { returns: policies.returns }),
          ...(policies.terms && { terms: policies.terms }),
          ...(policies.shipping && { shipping: policies.shipping }),
        },
      };
      await api.putStoreSettings(payload);
      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const sectionStyle = (key: string): React.CSSProperties => ({
    padding: "16px 20px",
    borderRadius: 12,
    border: `1px solid ${activeSection === key ? "var(--color-accent, #0f766e)" : "var(--color-border)"}`,
    background: activeSection === key ? "color-mix(in srgb, var(--color-accent, #0f766e) 4%, var(--color-bg))" : "var(--color-surface-raised)",
    cursor: "pointer",
    marginBottom: 12,
    transition: "border-color 0.15s, background 0.15s",
  });

  const fieldStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-bg)", fontSize: "13px", outline: "none" };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--color-muted)" }}>Carregando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 28 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)" }}>Loja</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>Configurações da Loja</h1>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>Redes sociais, dados empresariais e políticas. Essas informações aparecem no rodapé da sua loja e servem de contexto para a IA.</p>
      </header>

      <SaveFeedbackBanner result={saveResult} errorMessage={saveError ?? undefined} onDismiss={() => setSaveResult(null)} />

      {/* ─── Redes Sociais ─── */}
      <div style={sectionStyle("social")} onClick={() => setActiveSection("social")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: activeSection === "social" ? 16 : 0 }}>
          <Instagram size={18} style={{ color: "var(--color-accent)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Redes Sociais</span>
        </div>
        {activeSection === "social" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SocialField icon={<Instagram size={16} />} label="Instagram" placeholder="https://instagram.com/sua-loja" value={social.instagram} onChange={(v) => setSocial((s) => ({ ...s, instagram: v }))} />
            <SocialField icon={<Facebook size={16} />} label="Facebook" placeholder="https://facebook.com/sua-loja" value={social.facebook} onChange={(v) => setSocial((s) => ({ ...s, facebook: v }))} />
            <SocialField icon={<Linkedin size={16} />} label="LinkedIn" placeholder="https://linkedin.com/company/sua-empresa" value={social.linkedin} onChange={(v) => setSocial((s) => ({ ...s, linkedin: v }))} />
            <SocialField icon={<Youtube size={16} />} label="YouTube" placeholder="https://youtube.com/@seu-canal" value={social.youtube} onChange={(v) => setSocial((s) => ({ ...s, youtube: v }))} />
            <SocialField icon={<MapPin size={16} />} label="Google Maps" placeholder="https://maps.google.com/..." value={social.googleMaps} onChange={(v) => setSocial((s) => ({ ...s, googleMaps: v }))} />
          </div>
        )}
      </div>

      {/* ─── Dados da Empresa ─── */}
      <div style={sectionStyle("company")} onClick={() => setActiveSection("company")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: activeSection === "company" ? 16 : 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" /></svg>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Dados da Empresa</span>
        </div>
        {activeSection === "company" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>CNPJ</span>
                <input style={fieldStyle} placeholder="00.000.000/0000-00" value={company.cnpj} onChange={(e) => setCompany((c) => ({ ...c, cnpj: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Razão Social</span>
                <input style={fieldStyle} placeholder="Empresa LTDA" value={company.razaoSocial} onChange={(e) => setCompany((c) => ({ ...c, razaoSocial: e.target.value }))} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Inscrição Estadual</span>
                <input style={fieldStyle} placeholder="000.000.000" value={company.inscricaoEstadual} onChange={(e) => setCompany((c) => ({ ...c, inscricaoEstadual: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Email de contato</span>
                <input style={fieldStyle} type="email" placeholder="contato@empresa.com" value={company.email} onChange={(e) => setCompany((c) => ({ ...c, email: e.target.value }))} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Telefone</span>
                <input style={fieldStyle} placeholder="(11) 99999-9999" value={company.phone} onChange={(e) => setCompany((c) => ({ ...c, phone: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Horário de atendimento</span>
                <input style={fieldStyle} placeholder="Seg-Sex 9h às 18h" value={company.businessHours} onChange={(e) => setCompany((c) => ({ ...c, businessHours: e.target.value }))} />
              </label>
            </div>
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)" }}>Endereço</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Rua</span>
                <input style={fieldStyle} placeholder="Av. Paulista" value={company.street} onChange={(e) => setCompany((c) => ({ ...c, street: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Nº</span>
                <input style={fieldStyle} placeholder="1000" value={company.number} onChange={(e) => setCompany((c) => ({ ...c, number: e.target.value }))} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Bairro</span>
                <input style={fieldStyle} placeholder="Centro" value={company.neighborhood} onChange={(e) => setCompany((c) => ({ ...c, neighborhood: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Cidade</span>
                <input style={fieldStyle} placeholder="São Paulo" value={company.city} onChange={(e) => setCompany((c) => ({ ...c, city: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Estado</span>
                <input style={fieldStyle} placeholder="SP" maxLength={2} value={company.state} onChange={(e) => setCompany((c) => ({ ...c, state: e.target.value.toUpperCase() }))} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>CEP</span>
                <input style={fieldStyle} placeholder="01311-100" value={company.zip} onChange={(e) => setCompany((c) => ({ ...c, zip: e.target.value }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Complemento</span>
                <input style={fieldStyle} placeholder="Sala 101" value={company.complement} onChange={(e) => setCompany((c) => ({ ...c, complement: e.target.value }))} />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ─── Políticas ─── */}
      <div style={sectionStyle("policies")} onClick={() => setActiveSection("policies")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: activeSection === "policies" ? 16 : 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Políticas</span>
        </div>
        {activeSection === "policies" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }} onClick={(e) => e.stopPropagation()}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Política de Privacidade</span>
              <textarea style={{ ...fieldStyle, minHeight: 60, resize: "vertical" }} placeholder="URL ou texto da política de privacidade" value={policies.privacy} onChange={(e) => setPolicies((p) => ({ ...p, privacy: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Política de Devolução e Trocas</span>
              <textarea style={{ ...fieldStyle, minHeight: 60, resize: "vertical" }} placeholder="URL ou texto da política de devoluções" value={policies.returns} onChange={(e) => setPolicies((p) => ({ ...p, returns: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Termos de Uso</span>
              <textarea style={{ ...fieldStyle, minHeight: 60, resize: "vertical" }} placeholder="URL ou texto dos termos de uso" value={policies.terms} onChange={(e) => setPolicies((p) => ({ ...p, terms: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Política de Envio e Frete</span>
              <textarea style={{ ...fieldStyle, minHeight: 60, resize: "vertical" }} placeholder="URL ou texto da política de envio" value={policies.shipping} onChange={(e) => setPolicies((p) => ({ ...p, shipping: e.target.value }))} />
            </label>
          </div>
        )}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "12px 20px",
          borderRadius: 10,
          border: "none",
          background: "var(--color-accent, #0f766e)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
          marginTop: 8,
        }}
      >
        <Save size={16} />
        {saving ? "Salvando..." : "Salvar configurações"}
      </button>
    </div>
  );
}

function SocialField({ icon, label, placeholder, value, onChange }: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10 }} onClick={(e) => e.stopPropagation()}>
      <span style={{ flex: "none", color: "var(--color-muted)" }}>{icon}</span>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-bg)", fontSize: "13px", outline: "none" }}
      />
    </label>
  );
}
