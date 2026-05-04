import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CheckoutSettings, CheckoutSettingsMode, CheckoutSettingsPatch } from "@aacp/shared-types";
import { createDashboardApi, DashboardHttpError, type MerchantProfile as MerchantMeProfile } from "../api-client.js";

export function CheckoutSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [modeDraft, setModeDraft] = useState<CheckoutSettingsMode>("silent_until_trigger");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!props.me) {
        setSettings(null);
        setMessage(null);
        return;
      }
      try {
        const s = await api.getCheckoutSettings();
        setSettings(s);
        setModeDraft(s.mode);
        setMessage(null);
      } catch (e) {
        setSettings(null);
        const text =
          e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
        setMessage(props.me ? `Erro (${text})` : null);
      }
    }
    void load();
  }, [api, props.me]);

  async function reload() {
    if (!props.me) return;
    setBusy(true);
    try {
      const s = await api.getCheckoutSettings();
      setSettings(s);
      setModeDraft(s.mode);
      setMessage(null);
    } catch (e) {
      const text =
        e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro (${text})`);
    } finally {
      setBusy(false);
    }
  }

  async function patchMode(patch: CheckoutSettingsPatch) {
    setBusy(true);
    try {
      const s = await api.patchCheckoutSettings(patch);
      setSettings(s);
      setModeDraft(s.mode);
      setMessage("Alterações gravadas.");
    } catch (e) {
      const text =
        e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e);
      setMessage(`Erro (${text})`);
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Checkout settings</h1>
        <p className="page-lead">Login necessário para <code>GET/PUT /checkout-settings</code>.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Checkout settings</h1>
          <p className="page-lead">Mercado atual: `{props.me.id}` · `merchantId` omitido pelo backend.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void reload()}>
          <RefreshCw size={16} />
          Recarregar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      {!settings ? <p>Lendo servidor…</p> : null}
      {settings ? (
        <div className="panel stacked">
          <label>
            Modo do widget
            <select
              value={modeDraft}
              disabled={busy}
              onChange={(event) => setModeDraft(event.target.value as CheckoutSettingsMode)}
            >
              <option value="silent_until_trigger">silent_until_trigger</option>
              <option value="proactive">proactive</option>
              <option value="manual_only">manual_only</option>
            </select>
          </label>
          <button type="button" disabled={busy || modeDraft === settings.mode} onClick={() => void patchMode({ mode: modeDraft })}>
            Guardar modo
          </button>
          <p className="mono-small">Atualizado em {settings.updatedAt}</p>
        </div>
      ) : null}
    </>
  );
}
