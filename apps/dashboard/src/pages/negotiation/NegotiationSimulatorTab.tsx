import React, { useState } from "react";
import { FlaskConical, ShieldAlert } from "lucide-react";
import type { NegotiationEvaluateBridgeResponse } from "../../api-client.js";
import { DashboardHttpError } from "../../api-client.js";

export type SimulatorApi = {
  evaluateNegotiation(payload: Record<string, unknown>): Promise<NegotiationEvaluateBridgeResponse>;
};

const DEFAULT_BODY = [
  `{`,
  `  "globalUserId": "usr_demo_optional",`,
  `  "cart": {`,
  `    "total": 199.99,`,
  `    "items": [`,
  `      { "sku": "demo-kit", "price": 199.99, "quantity": 1, "categoryId": "kit" }`,
  `    ]`,
  `  }`,
  `}`,
].join("\n");

export function SafeJsonPre({ json }: { json: string }) {
  const lines = json.split("\n");
  return (
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
        flex: 1,
      }}
    >
      {lines.map((line, i) => {
        const parts: React.ReactNode[] = [];
        let remaining = line;
        let key = 0;

        const keyMatch = remaining.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:)(.*)$/);
        if (keyMatch) {
          const [, indent, k, colon, rest] = keyMatch;
          if (indent) parts.push(<span key={key++}>{indent}</span>);
          parts.push(<span key={key++} className="jk">{k}</span>);
          parts.push(<span key={key++}>{colon}</span>);
          remaining = rest;
        }

        const strMatch = remaining.match(/^(\s*)("(?:[^"\\]|\\.)*")(,?)\s*$/);
        if (strMatch) {
          const [, space, str, comma] = strMatch;
          if (space) parts.push(<span key={key++}>{space}</span>);
          parts.push(<span key={key++} className="js">{str}</span>);
          if (comma) parts.push(<span key={key++}>{comma}</span>);
        } else {
          const numMatch = remaining.match(/^(\s*)(\d+\.?\d*)(,?)\s*$/);
          if (numMatch) {
            const [, space, num, comma] = numMatch;
            if (space) parts.push(<span key={key++}>{space}</span>);
            parts.push(<span key={key++} className="jn">{num}</span>);
            if (comma) parts.push(<span key={key++}>{comma}</span>);
          } else {
            const boolMatch = remaining.match(/^(\s*)(true|false|null)(,?)\s*$/);
            if (boolMatch) {
              const [, space, val, comma] = boolMatch;
              if (space) parts.push(<span key={key++}>{space}</span>);
              parts.push(<span key={key++} className="jb">{val}</span>);
              if (comma) parts.push(<span key={key++}>{comma}</span>);
            } else {
              parts.push(<span key={key++}>{remaining}</span>);
            }
          }
        }

        return <span key={i}>{parts.length > 0 ? parts : line}{"\n"}</span>;
      })}
    </pre>
  );
}

export function NegotiationSimulatorTab({ api }: { api: SimulatorApi }) {
  const [jsonText, setJsonText] = useState(DEFAULT_BODY);
  const [pretty, setPretty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function evaluate() {
    setBusy(true);
    setPretty(null);
    try {
      const payload = JSON.parse(jsonText) as Record<string, unknown>;
      const res = await api.evaluateNegotiation(payload);
      setPretty(JSON.stringify(res, null, 2));
    } catch (e: any) {
      const msg =
        e instanceof SyntaxError
          ? `JSON inválido: ${e.message}`
          : (e instanceof DashboardHttpError && e.status === 404)
            ? "Endpoint de simulação não disponível. Configure o motor de negociação primeiro."
            : e instanceof DashboardHttpError
              ? `HTTP ${e.status} — ${e.responseBody.slice(0, 480)}`
              : e instanceof Error
                ? e.message
                : String(e);
      setPretty(msg);
    } finally {
      setBusy(false);
    }
  }

  const hasResponse = pretty !== null;
  const isErrorResponse = hasResponse && (pretty.startsWith("JSON") || pretty.startsWith("HTTP"));

  return (
    <div className="split-panel" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
      {/* Input */}
      <div className="split-panel-controls">
        <section className="panel stacked">
          <div className="panel-title">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <FlaskConical size={16} style={{ color: "var(--color-brand)" }} />
              <h2>Simulador — evaluate</h2>
            </div>
            <span className="badge muted" style={{ fontSize: 10 }}>POST /negotiations/evaluate</span>
          </div>

          <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0 }}>
            Corpo livre mergeado pelo backend com a política persistida.
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
                minHeight: 220,
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

      {/* Response */}
      <div className="split-panel-preview">
        <div className="panel stacked" style={{ minHeight: 480 }}>
          <div className="panel-title">
            <h2>Resposta</h2>
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
              {!isErrorResponse && <SafeJsonPre json={pretty} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
