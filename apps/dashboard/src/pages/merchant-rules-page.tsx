import React, { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { MerchantRules } from "@aacp/shared-types";
import type { MerchantProfile as MerchantMeProfile } from "../api-client.js";
import { createDashboardApi, DashboardHttpError } from "../api-client.js";
import { RulesForm } from "../components/rules-form.js";
import { QuickRepliesSection } from "../components/quick-replies-section.js";

export function MerchantRulesAuthenticatedPage(props: {
  apiBaseUrl: string;
  me: MerchantMeProfile | null;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [gate, setGate] = useState<"idle" | "401" | "error">("idle");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRules() {
      if (!props.me) {
        setRules(null);
        setGate("idle");
        setHint(null);
        return;
      }
      try {
        const rl = await api.getMerchantRules();
        setRules(rl);
        setGate("idle");
        setHint(null);
      } catch (e) {
        setRules(null);
        setHint(null);
        if (e instanceof DashboardHttpError && e.status === 401) setGate("401");
        else {
          setGate("error");
          setHint(
            e instanceof DashboardHttpError ? e.responseBody || e.message : e instanceof Error ? e.message : "Erro ao carregar regras"
          );
        }
      }
    }
    void fetchRules();
  }, [api, props.me]);

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    try {
      const saved = await api.putMerchantRules(rules);
      setRules(saved);
    } finally {
      setSaving(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Regras (sessão JWT)</h1>
        <p className="page-lead">
          Faça login na barra superior para ler e gravar <code>GET/PUT /merchants/me/rules</code> protegidas por cookie.
        </p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Regras do merchant atual</h1>
          <p className="page-lead">{props.me.name ?? props.me.id} · rotas `/merchants/me/rules`.</p>
        </div>
        <button type="button" disabled={saving || !rules} onClick={() => void saveRules()}>
          <Save size={16} />
          Salvar
        </button>
      </header>
      {gate === "401" ? (
        <p className="panel panel-warn">Sessão invalida ou expirada (401).</p>
      ) : null}
      {gate === "error" ? <p className="panel panel-warn">{hint ?? "Falha de rede"}</p> : null}
      {rules ? (
        <>
          <RulesForm rules={rules} onChange={setRules} />
          <div style={{ marginTop: 24 }}>
            <QuickRepliesSection
              value={rules.quickReplies}
              onChange={(qr) => setRules({ ...rules, quickReplies: qr })}
            />
          </div>
        </>
      ) : gate === "idle" ? <p>Carregando…</p> : null}
    </>
  );
}
