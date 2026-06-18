import React, { useEffect, useMemo, useState } from "react";
import { FlaskConical, Save } from "lucide-react";
import type { NegotiationPolicy, MerchantProfile as MerchantMeProfile } from "../api-client.js";
import { createDashboardApi, DashboardHttpError } from "../api-client.js";

const DEFAULT_BODY = [
  `{`,
  `  "globalUserId": "usr_demo_optional",`,
  `  "cart": {`,
  `    "total": 199.99,`,
  `    "items": [`,
  `      { "sku": "demo-kit", "price": 199.99, "quantity": 1, "categoryId": "kit" }`,
  `    ]`,
  `  }`,
  `}`
].join("\n");

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);
}

export function NegotiationPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);

  // simulator state
  const [jsonText, setJsonText] = useState(DEFAULT_BODY);
  const [pretty, setPretty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // policy editor state
  const [policy, setPolicy] = useState<NegotiationPolicy | null>(null);
  const [policyJson, setPolicyJson] = useState("");
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setPolicy(null);
      return;
    }
    void loadPolicy();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPolicy() {
    setPolicyLoading(true);
    setPolicyMessage(null);
    try {
      const p = await api.getNegotiationPolicy();
      setPolicy(p);
      setPolicyJson(JSON.stringify(p, null, 2));
    } catch (e) {
      setPolicyMessage(readError(e));
    } finally {
      setPolicyLoading(false);
    }
  }

  async function savePolicy() {
    setPolicyBusy(true);
    setPolicyMessage(null);
    try {
      const parsed = JSON.parse(policyJson) as NegotiationPolicy;
      const saved = await api.putNegotiationPolicy(parsed);
      setPolicy(saved);
      setPolicyJson(JSON.stringify(saved, null, 2));
      setPolicyMessage("Politica salva.");
    } catch (e) {
      setPolicyMessage(
        e instanceof SyntaxError ? `JSON invalido: ${e.message}` : readError(e),
      );
    } finally {
      setPolicyBusy(false);
    }
  }

  async function evaluate() {
    if (!props.me) return;
    setBusy(true);
    setPretty(null);
    try {
      const payload = JSON.parse(jsonText) as Record<string, unknown>;
      const res = await api.evaluateNegotiation(payload);
      setPretty(JSON.stringify(res, null, 2));
    } catch (e) {
      const msg =
        e instanceof SyntaxError
          ? ["JSON invalido:", e.message].join(" ")
          : e instanceof DashboardHttpError
            ? [`HTTP ${e.status}`, e.responseBody.slice(0, 480)].join(" — ")
            : e instanceof Error
              ? e.message
              : String(e);
      setPretty(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Negociação (form técnico)</h1>
        <p className="page-lead">Login obrigatório para <code>POST /negotiations/evaluate</code>.</p>
      </>
    );
  }

  return (
    <>
      {/* Policy editor section */}
      <section className="panel stacked" style={{ marginBottom: 24 }}>
        <div className="panel-title">
          <h2>Politica de negociacao</h2>
          <Save size={18} />
        </div>
        <p className="page-lead" style={{ marginBottom: 8 }}>
          Configuracao persistente: desconto maximo, flags e parametros do motor.
          Edite o JSON e salve.
        </p>
        {policyMessage ? <p className="panel panel-info">{policyMessage}</p> : null}
        {policyLoading ? <p className="panel panel-info">Carregando politica...</p> : null}
        <textarea
          spellCheck={false}
          disabled={policyBusy || policyLoading}
          className="mono-textarea"
          value={policyJson}
          onChange={(e) => setPolicyJson(e.target.value)}
          rows={10}
          aria-label="JSON da politica de negociacao"
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            disabled={policyBusy || policyLoading || !policy}
            onClick={() => void savePolicy()}
          >
            <Save size={16} />
            Salvar politica
          </button>
          <button
            type="button"
            disabled={policyBusy || policyLoading}
            onClick={() => void loadPolicy()}
          >
            Recarregar
          </button>
        </div>
      </section>

      {/* Simulator section */}
      <header className="page-head">
        <div>
          <h1>Simulator — evaluate</h1>
          <p className="page-lead">Corpo livre mergeado pelo backend com a policy persistida acima.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void evaluate()}>
          <FlaskConical size={16} />
          Executar
        </button>
      </header>
      <textarea
        spellCheck={false}
        disabled={busy}
        className="mono-textarea"
        value={jsonText}
        onChange={(event) => setJsonText(event.target.value)}
        aria-label="Payload de avaliacao de negociacao"
      />
      {pretty !== null ? <pre className="mono-pre">{pretty}</pre> : null}
    </>
  );
}
