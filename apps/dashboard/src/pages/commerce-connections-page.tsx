import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Link2, PlugZap, RefreshCw, ShoppingBag, Trash2, Zap } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type CommerceConnection,
  type MerchantProfile,
} from "../api-client.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

const PLATFORMS = ["shopify", "woocommerce", "vtex", "nuvemshop", "outro"];

const PLATFORM_LABELS: Record<string, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  vtex: "VTEX",
  nuvemshop: "Nuvemshop",
  outro: "Outro",
};

function statusBadge(status: string) {
  if (status === "active") return <span className="badge ok"><CheckCircle2 size={11} style={{ marginRight: 4 }} />Ativo</span>;
  if (status === "error") return <span className="badge bad"><AlertCircle size={11} style={{ marginRight: 4 }} />Erro</span>;
  return <span className="badge warn"><Clock size={11} style={{ marginRight: 4 }} />Pendente</span>;
}

export function CommerceConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<CommerceConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");

  // new connection form
  const [platform, setPlatform] = useState(PLATFORMS[0]!);
  const [shopDomain, setShopDomain] = useState("");

  useEffect(() => {
    if (!props.me) {
      setConnections([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      setConnections(await api.getCommerceConnections());
    } catch (e) {
      setMessage(readError(e));
      setMessageKind("error");
    } finally {
      setLoading(false);
    }
  }

  async function createConnection(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createCommerceConnection({
        platform,
        shop_domain: shopDomain.trim() || undefined,
      });
      setConnections((prev) => [created, ...prev]);
      setShopDomain("");
      setMessage("Conexão criada com sucesso.");
      setMessageKind("info");
    } catch (e) {
      setMessage(readError(e));
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.testCommerceConnection(id);
      setMessage(result.ok ? "Teste bem-sucedido." : `Falha no teste: ${result.message ?? "erro desconhecido"}`);
      setMessageKind(result.ok ? "info" : "error");
    } catch (e) {
      setMessage(readError(e));
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  }

  async function syncConnection(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.syncCommerceConnection(id);
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      setMessage("Sincronizado.");
      setMessageKind("info");
    } catch (e) {
      setMessage(readError(e));
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteConnection(id: string) {
    if (!window.confirm("Remover esta conexão de commerce?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteCommerceConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setMessage("Conexão removida.");
      setMessageKind("info");
    } catch (e) {
      setMessage(readError(e));
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Conexões de Commerce</h1>
            <p className="page-lead">Integre com Shopify, WooCommerce, VTEX e outras plataformas.</p>
          </div>
        </header>
        <div className="panel stacked">
          <div className="empty-state">
            <div className="empty-state-icon"><ShoppingBag size={22} /></div>
            <h3>Login necessário</h3>
            <p>Faça login para gerenciar integrações de loja.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Commerce</span>
          <h1>Conexões de Plataforma</h1>
          <p className="page-lead">Integre com Shopify, WooCommerce, VTEX e outras plataformas.</p>
        </div>
        <button type="button" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={15} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          Atualizar
        </button>
      </header>

      {message ? (
        <p className={messageKind === "error" ? "panel-error" : "panel-info"} style={{ marginBottom: "var(--space-4)" }}>
          {message}
        </p>
      ) : null}

      {/* Add connection form */}
      <section className="panel stacked" style={{ marginBottom: "var(--space-4)" }}>
        <div className="panel-title">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-brand-subtle)",
              color: "var(--color-brand)",
              flexShrink: 0,
            }}>
              <PlugZap size={18} />
            </div>
            <div>
              <h2 style={{ marginBottom: 2 }}>Nova Conexão</h2>
              <p style={{ margin: 0 }}>Conecte uma nova plataforma de e-commerce.</p>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => void createConnection(e)}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr auto",
            gap: "var(--space-3)",
            alignItems: "flex-end",
          }}
        >
          <label>
            Plataforma
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={busy}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Domínio da loja
            <input
              type="text"
              placeholder="minhaloja.myshopify.com"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy}
            style={{ alignSelf: "flex-end" }}
          >
            <Zap size={15} />
            {busy ? "Conectando..." : "Conectar"}
          </button>
        </form>
      </section>

      {/* Connection cards */}
      <section>
        <div className="section-header" style={{ marginBottom: "var(--space-4)" }}>
          <h2>Conexões Ativas</h2>
          {connections.length > 0 && (
            <span className="badge muted">{connections.length} {connections.length === 1 ? "conexão" : "conexões"}</span>
          )}
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {[1, 2].map((i) => (
              <div key={i} className="panel skeleton" style={{ height: 88 }} />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <div className="panel stacked">
            <div className="empty-state">
              <div className="empty-state-icon"><Link2 size={22} /></div>
              <h3>Nenhuma conexão configurada</h3>
              <p>Conecte sua primeira plataforma de e-commerce usando o formulário acima.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {connections.map((conn) => (
              <article key={conn.id} className="panel stacked" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-4) var(--space-5)" }}>
                {/* Platform icon */}
                <div style={{
                  width: 40,
                  height: 40,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-muted)",
                  flexShrink: 0,
                }}>
                  <ShoppingBag size={18} />
                </div>

                {/* Main info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: 4 }}>
                    <strong style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>
                      {PLATFORM_LABELS[conn.platform] ?? conn.platform}
                    </strong>
                    {statusBadge(conn.status)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                    {conn.shop_domain && (
                      <span style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--color-text-muted)" }}>
                        {conn.shop_domain}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                      Atualizado {formatDate(conn.updated_at)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => void testConnection(conn.id)}
                    title="Testar conexão"
                  >
                    <Zap size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => void syncConnection(conn.id)}
                    title="Sincronizar"
                  >
                    <RefreshCw size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    onClick={() => void deleteConnection(conn.id)}
                    title="Remover conexão"
                    style={{ color: "var(--color-error)" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
