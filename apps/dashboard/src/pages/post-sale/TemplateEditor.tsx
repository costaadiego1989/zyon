import React, { useEffect, useState } from "react";
import { Sparkles, Save, Send, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import {
  usePostSaleTemplates,
  TEMPLATE_TYPES,
  TEMPLATE_CHANNELS,
  type TemplateChannel,
} from "./usePostSaleTemplates.js";

/**
 * Merchant-editable post-sale message templates.
 *
 * Two layers:
 *  - Freeform body → e-mail + WhatsApp inside the 24h session window.
 *  - Meta template (positional {{1}} vars) → business-initiated WhatsApp, must
 *    be approved by Meta (submitted via Twilio) before it can be sent. Without
 *    an approved template the system falls back to e-mail (no ban risk).
 */
export function TemplateEditor(props: { me: MerchantProfile | null }) {
  const tpl = usePostSaleTemplates({ me: props.me });
  const [type, setType] = useState<string>(TEMPLATE_TYPES[0].type);
  const [channel, setChannel] = useState<TemplateChannel>("whatsapp");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Meta template draft (positional body + variable map + category).
  const [metaBody, setMetaBody] = useState("");
  const [metaVarMap, setMetaVarMap] = useState<Record<string, string>>({});
  const [metaCategory, setMetaCategory] = useState<string>("UTILITY");
  const [metaLanguage, setMetaLanguage] = useState<string>("pt_BR");
  const [tone, setTone] = useState<string>("amigavel");

  const key = `${type}:${channel}`;
  const meta = TEMPLATE_TYPES.find((t) => t.type === type)!;
  const saving = tpl.savingKey === key;
  const generating = tpl.generatingKey === key;
  const stored = tpl.get(type, channel);
  const metaStatus = stored?.metaStatus ?? "draft";
  const isWhatsApp = channel === "whatsapp";

  // Load the selected template into the form whenever selection or data changes.
  useEffect(() => {
    const existing = tpl.get(type, channel);
    setName(existing?.name ?? meta.label);
    setSubject(existing?.subject ?? "");
    setBody(existing?.body ?? "");
    setMetaBody(existing?.metaTemplateBody ?? "");
    setMetaVarMap((existing?.metaVariableMap as Record<string, string>) ?? {});
    setMetaCategory(existing?.metaCategory ?? (type === "cross_sell" ? "MARKETING" : "UTILITY"));
    setMetaLanguage(existing?.metaLanguage ?? "pt_BR");
  }, [type, channel, tpl.templates]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onGenerate() {
    const res = await tpl.generate(type, channel, { storeName: props.me?.name, tone });
    if (res) {
      setName(res.name || name);
      setBody(res.body || body);
      if (res.subject) setSubject(res.subject);
      if (res.meta) {
        setMetaBody(res.meta.metaBody);
        setMetaVarMap(res.meta.variableMap);
        setMetaCategory(res.meta.category);
        setMetaLanguage(res.meta.language);
      }
    }
  }

  async function onSave() {
    if (!body.trim()) return;
    await tpl.save(type, channel, {
      name: name.trim() || meta.label,
      body: body.trim(),
      subject: channel === "email" ? subject.trim() || undefined : undefined,
      metaCategory: metaCategory,
      metaLanguage: metaLanguage,
      metaTemplateBody: metaBody.trim() || undefined,
      metaVariableMap: Object.keys(metaVarMap).length ? metaVarMap : undefined,
    });
  }

  async function onSubmitMeta() {
    // Persist first so the backend has the latest meta body to submit.
    await onSave();
    await tpl.submitMeta(type, channel);
  }

  const statusBadge = (
    <span style={badgeStyle(metaStatus)}>{statusLabel(metaStatus)}</span>
  );

  return (
    <div style={{ marginTop: 32 }}>
      <SectionHeader
        title="Templates de Mensagem"
        subtitle="Personalize o texto de cada campanha. Deixe em branco para usar o padrão da plataforma."
        variant="secondary"
      />

      {/* Type + channel selectors */}
      <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        <label style={fieldCol}>
          <span style={labelStyle}>Campanha</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
            {TEMPLATE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>{t.label}</option>
            ))}
          </select>
        </label>

        <label style={fieldCol}>
          <span style={labelStyle}>Canal</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value as TemplateChannel)} style={selectStyle}>
            {TEMPLATE_CHANNELS.map((c) => (
              <option key={c} value={c}>{c === "whatsapp" ? "WhatsApp" : "E-mail"}</option>
            ))}
          </select>
        </label>

        <label style={fieldCol}>
          <span style={labelStyle}>Tom da IA</span>
          <select value={tone} onChange={(e) => setTone(e.target.value)} style={selectStyle}>
            <option value="amigavel">Amigável</option>
            <option value="profissional">Profissional</option>
            <option value="descontraido">Descontraído</option>
            <option value="promocional">Promocional</option>
            <option value="luxo">Luxo / Premium</option>
          </select>
        </label>
      </div>

      {/* Email subject */}
      {channel === "email" && (
        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Assunto</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail" style={{ ...inputStyle, width: "100%", marginTop: 4 }} />
        </div>
      )}

      {/* Name */}
      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Nome interno</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.label} style={{ ...inputStyle, width: "100%", marginTop: 4 }} />
      </div>

      {/* Freeform body */}
      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Mensagem {isWhatsApp ? "(texto — usado em e-mail / janela 24h)" : ""}</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Digite a mensagem ou gere uma sugestão com IA…"
          style={{ ...inputStyle, width: "100%", marginTop: 4, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
        />
      </div>

      <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 8, lineHeight: 1.6 }}>
        Variáveis: <code>{"{{buyerName}}"}</code> <code>{"{{productName}}"}</code> <code>{"{{storeName}}"}</code>
        {meta.hasCoupon && (<> <code>{"{{couponBlock}}"}</code> — o cupom é inserido automaticamente aqui quando houver.</>)}
      </div>

      {/* Meta template pane (WhatsApp only) */}
      {isWhatsApp && (
        <div style={{ marginTop: 24, padding: 16, borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface-subtle, var(--color-surface))" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
              Template WhatsApp oficial (Meta)
            </div>
            {statusBadge}
          </div>
          <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 6, lineHeight: 1.6 }}>
            Mensagens fora da janela de 24h exigem template aprovado pela Meta. Variáveis posicionais <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… Sem aprovação, o envio cai para e-mail automaticamente.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <label style={fieldCol}>
              <span style={labelStyle}>Categoria</span>
              <select value={metaCategory} onChange={(e) => setMetaCategory(e.target.value)} style={selectStyle}>
                <option value="UTILITY">UTILITY (transacional)</option>
                <option value="MARKETING">MARKETING (promocional)</option>
              </select>
            </label>
            <label style={fieldCol}>
              <span style={labelStyle}>Idioma</span>
              <input value={metaLanguage} onChange={(e) => setMetaLanguage(e.target.value)} style={{ ...inputStyle, minWidth: 120 }} />
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Corpo do template (posicional)</label>
            <textarea
              value={metaBody}
              onChange={(e) => setMetaBody(e.target.value)}
              rows={5}
              placeholder="Ex.: Oi {{1}}! Use o cupom {{2}} e ganhe {{3}} OFF."
              style={{ ...inputStyle, width: "100%", marginTop: 4, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
            />
          </div>

          {Object.keys(metaVarMap).length > 0 && (
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 8 }}>
              Variáveis: {Object.entries(metaVarMap).map(([pos, n]) => (
                <code key={pos} style={{ marginRight: 8 }}>{`{{${pos}}}`}={n}</code>
              ))}
            </div>
          )}

          {stored?.metaRejectionReason && metaStatus === "rejected" && (
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-danger, #c0392b)", marginTop: 8 }}>
              Rejeitado pela Meta: {stored.metaRejectionReason}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Button variant="outline" onClick={() => tpl.refreshMetaStatus(type, channel)} disabled={saving}>
              <RefreshCw size={14} style={{ marginRight: 6 }} />
              Atualizar status
            </Button>
            <Button variant="primary" onClick={onSubmitMeta} disabled={saving || generating || !metaBody.trim()}>
              <Send size={14} style={{ marginRight: 6 }} />
              Enviar para aprovação Meta
            </Button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <Button variant="outline" onClick={onGenerate} disabled={generating || saving}>
          <Sparkles size={15} style={{ marginRight: 6 }} />
          {generating ? "Gerando…" : "Gerar com IA"}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving || generating || !body.trim()}>
          <Save size={15} style={{ marginRight: 6 }} />
          {saving ? "Salvando…" : "Salvar template"}
        </Button>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "approved": return "Aprovado";
    case "submitted": return "Em análise";
    case "rejected": return "Rejeitado";
    default: return "Rascunho";
  }
}

function badgeStyle(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    approved: { bg: "rgba(39,174,96,0.15)", fg: "#1e8449" },
    submitted: { bg: "rgba(243,156,18,0.15)", fg: "#b9770e" },
    rejected: { bg: "rgba(192,57,43,0.15)", fg: "#c0392b" },
    draft: { bg: "var(--color-surface)", fg: "var(--color-text-muted)" },
  };
  const c = palette[status] ?? palette.draft;
  return {
    font: "600 11px var(--font-sans)",
    padding: "3px 10px",
    borderRadius: 999,
    background: c.bg,
    color: c.fg,
    border: "1px solid var(--color-border)",
  };
}

const fieldCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelStyle: React.CSSProperties = { font: "600 12px var(--font-sans)", color: "var(--color-text-muted)" };
const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  font: "13px var(--font-sans)",
  minWidth: 180,
};
const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  font: "13px var(--font-sans)",
};
