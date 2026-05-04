import React, { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import type { MerchantProfile as MerchantMeProfile } from "../api-client.js";
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

export function NegotiationPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [jsonText, setJsonText] = useState(DEFAULT_BODY);
  const [pretty, setPretty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <header className="page-head">
        <div>
          <h1>Simulator — evaluate</h1>
          <p className="page-lead">Corpo livre mergeado pelo backend com policy/prefs persisted.</p>
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
      />
      {pretty !== null ? <pre className="mono-pre">{pretty}</pre> : null}
    </>
  );
}
