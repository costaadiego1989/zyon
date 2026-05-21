import React, { useMemo, useState } from "react";
import { Code2, Copy, KeyRound } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type EmbedSessionResponse, type MerchantProfile } from "../api-client.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

export function EmbedPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [allowedOrigin, setAllowedOrigin] = useState("https://store.example");
  const [cartRef, setCartRef] = useState("cart_123");
  const [ttl, setTtl] = useState(900);
  const [session, setSession] = useState<EmbedSessionResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    setMessage(null);
    try {
      setSession(await api.createEmbedSession({
        ttl_seconds: ttl,
        allowed_origin: allowedOrigin,
        cart_ref: cartRef,
        scopes: EMBED_SCOPES
      }));
      setMessage("Token emitido.");
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const snippet = session
    ? `<script src="${props.apiBaseUrl}/widget/aacp.js" data-aacp-token="${session.embed_session_token}" async></script>`
    : `<script src="${props.apiBaseUrl}/widget/aacp.js" data-aacp-token="EMBED_SESSION_TOKEN" async></script>`;

  if (!props.me) {
    return (
      <>
        <h1>Embed</h1>
        <p className="page-lead">Login necessario.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Embed</h1>
          <p className="page-lead">Token scoped, origin-bound e pronto para storefront.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void issue()}>
          <KeyRound size={16} />
          Emitir token
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      <div className="ops-grid">
        <section className="panel stacked">
          <h2>Issuance</h2>
          <div className="form-grid">
            <label>
              Allowed origin
              <input value={allowedOrigin} onChange={(event) => setAllowedOrigin(event.target.value)} />
            </label>
            <label>
              Cart ref
              <input value={cartRef} onChange={(event) => setCartRef(event.target.value)} />
            </label>
            <label>
              TTL segundos
              <input type="number" min={60} max={86400} value={ttl} onChange={(event) => setTtl(Number(event.target.value))} />
            </label>
          </div>
          {session ? <p className="mono-small">Expira em {session.expires_at_unix}</p> : null}
        </section>
        <section className="panel stacked">
          <div className="panel-title">
            <h2>Snippet</h2>
            <button type="button" onClick={() => navigator.clipboard?.writeText(snippet)}>
              <Copy size={14} />
              Copiar
            </button>
          </div>
          <pre className="code-block">
            <code>{snippet}</code>
          </pre>
          <div className="panel-title">
            <h2>Scopes</h2>
            <Code2 size={16} />
          </div>
          <div className="chip-row">
            {EMBED_SCOPES.map((scope) => (
              <span key={scope} className="badge">{scope}</span>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
