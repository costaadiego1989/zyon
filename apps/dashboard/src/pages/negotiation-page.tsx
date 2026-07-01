import React, { useEffect, useMemo, useState } from "react";
import { FlaskConical, RefreshCw, Save, ShieldAlert, Sliders } from "lucide-react";
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

/** Minimal syntax colouring for JSON strings in a <pre> */
function colorizeJson(raw: string): React.ReactNode {
  const lines = raw.split("\n");
  return lines.map((line, i) => {
    const colored = line
      .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="jk">$1</span>$2')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="js">$1</span>')
      .replace(/:\s*(\d+\.?\d*)/g, ': <span class="jn">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="jb">$1</span>');
    return (
      <span key={i} dangerouslySetInnerHTML={{ __html: colored + "\n" }} />
    );
  });
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
      setPolicyMessage("Política salva com sucesso.");
    } catch (e) {
      setPolicyMessage(
        e instanceof SyntaxError ? `JSON inválido: ${e.message}` : readError(e),
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
          ? ["JSON inválido:", e.message].join(" ")
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
      <div className="dashboard-content">
        <div className="empty-state">
          <div className="empty-state-icon"><FlaskConical size={22} /></div>
          <h3>Autenticação necessária</h3>
          <p>Login obrigatório para acessar <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>POST /negotiations/evaluate</code>.</p>
        </div>
      </div>
    );
  }

  const hasResponse = pretty !== null;
  const isErrorResponse = hasResponse && (pretty.startsWith("JSON") || pretty.startsWith("HTTP"));

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <h1>Motor de Negociação</h1>
          <p className="page-lead">
            Teste o motor de avaliação com payloads livres e ajuste a política persistida
            que define descontos máximos, flags e parâmetros de margem.
          </p>
        </div>
      </header>

      <div className="split-panel" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>

        {/* Left column — policy editor + simulator input */}
        <div className="split-panel-controls">

          {/* Policy editor */}
          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Sliders size={16} style={{ color: "var(--color-brand)" }} />
                <h2>Política de negociação</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                {policyLoading && <span className="badge muted">carregando…</span>}
                {policy && !policyLoading && <span className="badge ok">carregada</span>}
              </div>
            </div>

            <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0 }}>
              Configuração persistente: desconto máximo, flags e parâmetros do motor.
              Edite o JSON e salve.
            </p>

            {policyMessage && (
              <p className={policyMessage.includes("sucesso") ? "panel-info" : "panel-warn"}>
                {policyMessage}
              </p>
            )}

            <div className="developer-code" style={{ borderRadius: "var(--radius-md)" }}>
              <div className="panel-title" style={{ padding: "var(--space-2) var(--space-3)", background: "#0F172A", borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "#94A3B8", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  policy.json
                </span>
                <span className="badge muted" style={{ fontSize: 10 }}>PUT /negotiations/policy</span>
              </div>
              <textarea
                spellCheck={false}
                disabled={policyBusy || policyLoading}
                className="mono-textarea"
                value={policyJson}
                onChange={(e) => setPolicyJson(e.target.value)}
                rows={10}
                aria-label="JSON da política de negociação"
                style={{
                  width: "100%",
                  borderRadius: "0 0 var(--radius-md) var(--radius-md)",
                  border: "none",
                  borderTop: "1px solid #1E293B",
                  background: "#111827",
                  color: "#E2E8F0",
                  resize: "vertical",
                  minHeight: 200
                }}
              />
            </div>

            <div className="button-row">
              <button
                type="button"
                className="btn-primary"
                disabled={policyBusy || policyLoading || !policy}
                onClick={() => void savePolicy()}
              >
                <Save size={14} />
                {policyBusy ? "Salvando…" : "Salvar política"}
              </button>
              <button
                type="button"
                disabled={policyBusy || policyLoading}
                onClick={() => void loadPolicy()}
              >
                <RefreshCw size={14} />
                Recarregar
              </button>
            </div>
          </section>

          {/* Simulator input */}
          <section className="panel stacked">
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <FlaskConical size={16} style={{ color: "var(--color-brand)" }} />
                <h2>Simulador — evaluate</h2>
              </div>
              <span className="badge muted" style={{ fontSize: 10 }}>POST /negotiations/evaluate</span>
            </div>

            <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0 }}>
              Corpo livre mergeado pelo backend com a política persistida acima.
            </p>

            <div className="developer-code" style={{ borderRadius: "var(--radius-md)" }}>
              <div className="panel-title" style={{ padding: "var(--space-2) var(--space-3)", background: "#0F172A", borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "#94A3B8", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  payload.json
                </span>
                {busy && <span className="badge muted" style={{ fontSize: 10, color: "#64748B" }}>executando…</span>}
              </div>
              <textarea
                spellCheck={false}
                disabled={busy}
                className="mono-textarea"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                aria-label="Payload de avaliação de negociação"
                style={{
                  width: "100%",
                  borderRadius: "0 0 var(--radius-md) var(--radius-md)",
                  border: "none",
                  borderTop: "1px solid #1E293B",
                  background: "#111827",
                  color: "#E2E8F0",
                  resize: "vertical",
                  minHeight: 220
                }}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void evaluate()}
            >
              <FlaskConical size={14} />
              {busy ? "Executando…" : "Simular avaliação"}
            </button>
          </section>
        </div>

        {/* Right column — response panel */}
        <div className="split-panel-preview">
          <div className="panel stacked" style={{ minHeight: 480 }}>
            <div className="panel-title">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <h2>Resposta</h2>
              </div>
              {hasResponse && (
                <span className={`badge ${isErrorResponse ? "bad" : "ok"}`}>
                  {isErrorResponse ? "erro" : "sucesso"}
                </span>
              )}
            </div>

            {!hasResponse && !busy && (
              <div className="empty-state" style={{ padding: "var(--space-10) var(--space-6)", flex: 1 }}>
                <div className="empty-state-icon">
                  <FlaskConical size={22} />
                </div>
                <h3>Sem resposta ainda</h3>
                <p>
                  Preencha o payload e clique em "Simular avaliação" para ver a resposta do motor de negociação aqui.
                </p>
              </div>
            )}

            {busy && (
              <div className="empty-state" style={{ padding: "var(--space-10) var(--space-6)", flex: 1 }}>
                <div className="skeleton" style={{ width: "100%", height: 14, borderRadius: "var(--radius-sm)", marginBottom: 8 }} />
                <div className="skeleton" style={{ width: "80%", height: 14, borderRadius: "var(--radius-sm)", marginBottom: 8 }} />
                <div className="skeleton" style={{ width: "90%", height: 14, borderRadius: "var(--radius-sm)" }} />
              </div>
            )}

            {hasResponse && !busy && (
              <>
                {isErrorResponse && (
                  <div className="panel-error" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <ShieldAlert size={14} />
                    {pretty}
                  </div>
                )}
                {!isErrorResponse && (
                  <>
                    {/* JSON syntax highlighting styles scoped inline */}
                    <style>{`
                      .neg-response .jk { color: #7DD3FC; }
                      .neg-response .js { color: #86EFAC; }
                      .neg-response .jn { color: #FCA5A5; }
                      .neg-response .jb { color: #C4B5FD; }
                    `}</style>
                    <pre
                      className="neg-response"
                      style={{
                        margin: 0,
                        padding: "var(--space-4)",
                        borderRadius: "var(--radius-sm)",
                        background: "#0F172A",
                        color: "#E2E8F0",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        lineHeight: 1.65,
                        overflow: "auto",
                        maxHeight: "min(560px, 65vh)",
                        flex: 1
                      }}
                    >
                      {colorizeJson(pretty)}
                    </pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
