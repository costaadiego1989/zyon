import React, { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ChevronDown, Save } from "lucide-react";
import { DashboardHttpError } from "../../api-client.js";
import type { MerchantProfile } from "../../api/types.js";
import type { SupportNotificationSettings as Settings } from "../../api/endpoints/support.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { canonicalSupportPhone, formatSupportPhone } from "./support-notification-phone.js";
import "./support-notification-settings.css";

type Api = Pick<ReturnType<typeof import("../../api-client.js").createDashboardApi>, "getSupportNotificationSettings" | "putSupportNotificationSettings">;
interface Props { api: Api; me: MerchantProfile | null }

export function SupportNotificationSettings({ api, me }: Props) {
  if (!me?.id || !me.user_id || (me.role !== "OWNER" && me.role !== "ADMIN")) return null;
  return <PrivateNotificationSettings key={JSON.stringify([me.id, me.user_id])} api={api} />;
}

function PrivateNotificationSettings({ api }: { api: Api }) {
  const [saved, setSaved] = useState<Settings>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; load: boolean } | null>(null);
  const epoch = useRef(0), request = useRef(0), edits = useRef(0), inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    const generation = epoch.current, operation = ++request.current, revision = edits.current;
    const live = () => generation === epoch.current && operation === request.current;
    setLoading(true); setError(null);
    try {
      const result = await api.getSupportNotificationSettings();
      if (!live()) return;
      setSaved(result);
      if (revision === edits.current) setDraft(formatSupportPhone(result.fallbackPhone ?? ""));
    } catch {
      if (live()) setError({ message: "Não foi possível carregar o telefone da equipe. Tente novamente para conferir a configuração.", load: true });
    } finally { if (live()) setLoading(false); }
  }, [api]);

  useEffect(() => {
    epoch.current++; request.current++; edits.current = 0; inFlight.current = false;
    setSaved(undefined); setDraft(""); setSaving(false); void load();
    return () => { epoch.current++; request.current++; inFlight.current = false; };
  }, [load]);

  async function save(value: string | null) {
    if (inFlight.current || loading) return;
    inFlight.current = true;
    const generation = epoch.current, operation = ++request.current, revision = edits.current;
    const live = () => generation === epoch.current && operation === request.current;
    setSaving(true); setError(null);
    try {
      const result = await api.putSupportNotificationSettings(canonicalSupportPhone(value));
      if (!live()) return;
      setSaved(result);
      if (revision === edits.current) setDraft(formatSupportPhone(result.fallbackPhone ?? ""));
    } catch (cause) {
      if (!live()) return;
      const message = cause instanceof DashboardHttpError && cause.status === 400
        ? "Confira o DDD e o número de telefone antes de salvar."
        : cause instanceof DashboardHttpError && cause.status === 403
          ? "Você não tem permissão para configurar o telefone da equipe. Suas alterações não foram salvas."
          : "Não foi possível salvar o telefone. Suas alterações foram preservadas para tentar novamente.";
      setError({ message, load: false });
    } finally { if (live()) { inFlight.current = false; setSaving(false); } }
  }

  const dirty = canonicalSupportPhone(draft) !== (saved?.fallbackPhone ?? "");
  return <section className="support-notification-settings" aria-label="Alertas de atendimento" aria-busy={loading || saving}>
    <SectionHeader title="Alertas de atendimento" subtitle="Receba um aviso quando um cliente pedir para falar com sua equipe."
      trailing={saved && <span className="support-notification-status" data-configured={!!saved.fallbackPhone}>{saved.fallbackPhone ? "Telefone configurado" : "Telefone não configurado"}</span>} />
    <div className="support-notification-layout">
      <div className="support-notification-context"><BellRing size={20} strokeWidth={1.6} aria-hidden="true" />
        <h3>Atendimento humano</h3><p>Defina quem recebe os avisos. A conversa continua na central do WhatsApp.</p>
      </div>
      <div className="support-notification-form">
        {loading && <p role="status">Carregando o telefone da equipe…</p>}
        <FormField label="WhatsApp da equipe" type="tel" value={draft} maxLength={40} disabled={loading || saving} placeholder="(11) 99999-9999"
          inputProps={{ inputMode: "tel", autoComplete: "tel-national" }}
          hint="Informe o DDD e o número. Este contato é privado e não aparece para compradores."
          onChange={value => { edits.current++; setDraft(formatSupportPhone(value)); setError(null); }} />
        {error && <div className="support-notification-feedback" role="alert"><p>{error.message}</p>
          {error.load && <Button variant="outline" onClick={() => void load()}>Tentar novamente</Button>}</div>}
        <div className="support-notification-actions">
          <Button loading={saving} disabled={loading || saving || !draft.trim() || !dirty} onClick={() => void save(draft)}><Save size={16} aria-hidden="true" />Salvar telefone</Button>
          {saved?.fallbackPhone && <Button variant="outline" disabled={loading || saving} onClick={() => void save(null)}>Remover telefone</Button>}
        </div>
        <details className="support-notification-disclosure"><summary>Sobre os avisos <ChevronDown size={16} aria-hidden="true" /></summary>
          <p>Salvar o telefone configura os próximos alertas. A confirmação de envio aparece na conversa.</p>
        </details>
      </div>
    </div>
  </section>;
}
