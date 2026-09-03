import React, { useMemo, useState } from "react";
import { Sparkles, Save, Send, RefreshCw, Pencil } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { SidePanel } from "../../components/SidePanel.js";
import { Pagination } from "../../components/Pagination.js";
import { usePostSaleTemplates, TEMPLATE_TYPES } from "../post-sale/usePostSaleTemplates.js";

const PAGE_SIZE = 6;
const CHANNEL = "whatsapp";

/**
 * WhatsApp templates tab: paginated list of every catalog type with its Meta
 * approval status. Clicking a row opens a lateral drawer to edit the message
 * (with AI generation) and submit it to Meta for approval.
 */
export function WhatsAppTemplatesTab(props: { me: MerchantProfile | null }) {
  const tpl = usePostSaleTemplates({ me: props.me });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null); // type being edited

  const rows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return TEMPLATE_TYPES.slice(start, start + PAGE_SIZE);
  }, [page]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)" }}>Templates de Mensagem</div>
        <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
          Cada campanha tem um template aprovado pela Meta no seu WhatsApp. Clique para editar com IA e enviar para aprovação.
        </p>
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        {rows.map((t, i) => {
          const rec = tpl.get(t.type, CHANNEL);
          const status = rec?.metaStatus ?? "draft";
          return (
            <button
              key={t.type}
              onClick={() => setEditing(t.type)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "14px 18px",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>{t.label}</div>
                <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 2 }}>
                  {t.type}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={badgeStyle(status)}>{statusLabel(status)}</span>
                <Pencil size={14} style={{ color: "var(--color-text-muted)" }} />
              </div>
            </button>
          );
        })}
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={TEMPLATE_TYPES.length} onChange={setPage} disabled={tpl.loading} />

      <SidePanel
        isOpen={editing !== null}
        title={editing ? (TEMPLATE_TYPES.find((t) => t.type === editing)?.label ?? "Template") : "Template"}
        onClose={() => setEditing(null)}
      >
        {editing && <TemplateDrawerForm me={props.me} tpl={tpl} type={editing} />}
      </SidePanel>
    </div>
  );
}

function TemplateDrawerForm(props: {
  me: MerchantProfile | null;
  tpl: ReturnType<typeof usePostSaleTemplates>;
  type: string;
}) {
  const { tpl, type } = props;
  const meta = TEMPLATE_TYPES.find((t) => t.type === type)!;
  const existing = tpl.get(type, CHANNEL);
  const key = `${type}:${CHANNEL}`;
  const saving = tpl.savingKey === key;
  const generating = tpl.generatingKey === key;

  const [name, setName] = useState(existing?.name ?? meta.label);
  const [body, setBody] = useState(existing?.body ?? "");
  const [metaBody, setMetaBody] = useState(existing?.metaTemplateBody ?? "");
  const [metaVarMap, setMetaVarMap] = useState<Record<string, string>>(
    (existing?.metaVariableMap as Record<string, string>) ?? {}
  );
  const [metaCategory, setMetaCategory] = useState(existing?.metaCategory ?? (type === "cross_sell" || type === "win_back" || type === "cart_recovery" ? "MARKETING" : "UTILITY"));
  const [metaLanguage, setMetaLanguage] = useState(existing?.metaLanguage ?? "pt_BR");
  const [tone, setTone] = useState("amigavel");

  const status = existing?.metaStatus ?? "draft";

  async function onGenerate() {
    const res = await tpl.generate(type, CHANNEL, { storeName: props.me?.name, tone });
    if (res) {
      setName(res.name || name);
      setBody(res.body || body);
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
    await tpl.save(type, CHANNEL, {
      name: name.trim() || meta.label,
      body: body.trim(),
      metaCategory,
      metaLanguage,
      metaTemplateBody: metaBody.trim() || undefined,
      metaVariableMap: Object.keys(metaVarMap).length ? metaVarMap : undefined,
    });
  }

  async function onSubmitMeta() {
    await onSave();
    await tpl.submitMeta(type, CHANNEL);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={badgeStyle(status)}>{statusLabel(status)}</span>
        {existing?.twilioContentSid && (
          <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>{existing.twilioContentSid}</span>
        )}
      </div>

      {status === "rejected" && existing?.metaRejectionReason && (
        <div style={{ font: "12px var(--font-sans)", color: "var(--color-danger, #c0392b)" }}>
          Rejeitado pela Meta: {existing.metaRejectionReason}
        </div>
      )}

      <label style={col}>
        <span style={label}>Tom da IA</span>
        <select value={tone} onChange={(e) => setTone(e.target.value)} style={input}>
          <option value="amigavel">Amigável</option>
          <option value="profissional">Profissional</option>
          <option value="descontraido">Descontraído</option>
          <option value="promocional">Promocional</option>
          <option value="luxo">Luxo / Premium</option>
        </select>
      </label>

      <label style={col}>
        <span style={label}>Nome interno</span>
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder={meta.label} />
      </label>

      <label style={col}>
        <span style={label}>Mensagem (texto — e-mail / janela 24h)</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} style={{ ...input, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }} placeholder="Digite ou gere com IA…" />
      </label>

      <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-subtle, var(--color-surface))" }}>
        <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)", marginBottom: 8 }}>Template Meta (oficial)</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={metaCategory} onChange={(e) => setMetaCategory(e.target.value)} style={{ ...input, flex: 1 }}>
            <option value="UTILITY">UTILITY</option>
            <option value="MARKETING">MARKETING</option>
          </select>
          <input value={metaLanguage} onChange={(e) => setMetaLanguage(e.target.value)} style={{ ...input, width: 90 }} />
        </div>
        <textarea value={metaBody} onChange={(e) => setMetaBody(e.target.value)} rows={4} style={{ ...input, width: "100%", resize: "vertical", fontFamily: "var(--font-mono, monospace)" }} placeholder="Ex.: Oi {{1}}! Use {{2}}" />
        {Object.keys(metaVarMap).length > 0 && (
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 6 }}>
            {Object.entries(metaVarMap).map(([p, n]) => (
              <code key={p} style={{ marginRight: 8 }}>{`{{${p}}}`}={n}</code>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="outline" onClick={onGenerate} disabled={generating || saving}>
          <Sparkles size={14} style={{ marginRight: 6 }} />
          {generating ? "Gerando…" : "Gerar com IA"}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving || generating || !body.trim()}>
          <Save size={14} style={{ marginRight: 6 }} />
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="outline" onClick={() => tpl.refreshMetaStatus(type, CHANNEL)} disabled={saving}>
          <RefreshCw size={13} style={{ marginRight: 6 }} />
          Status
        </Button>
        <Button variant="primary" onClick={onSubmitMeta} disabled={saving || generating || !metaBody.trim()}>
          <Send size={13} style={{ marginRight: 6 }} />
          Enviar para aprovação Meta
        </Button>
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "approved": return "Aprovado";
    case "submitted": return "Em análise";
    case "rejected": return "Rejeitado";
    default: return "Rascunho";
  }
}

function badgeStyle(s: string): React.CSSProperties {
  const pal: Record<string, { bg: string; fg: string }> = {
    approved: { bg: "rgba(39,174,96,0.15)", fg: "#1e8449" },
    submitted: { bg: "rgba(243,156,18,0.15)", fg: "#b9770e" },
    rejected: { bg: "rgba(192,57,43,0.15)", fg: "#c0392b" },
    draft: { bg: "var(--color-surface)", fg: "var(--color-text-muted)" },
  };
  const c = pal[s] ?? pal.draft;
  return {
    font: "600 11px var(--font-sans)",
    padding: "3px 10px",
    borderRadius: 999,
    background: c.bg,
    color: c.fg,
    border: "1px solid var(--color-border)",
    whiteSpace: "nowrap",
  };
}

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: React.CSSProperties = { font: "600 12px var(--font-sans)", color: "var(--color-text-muted)" };
const input: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  font: "13px var(--font-sans)",
};
