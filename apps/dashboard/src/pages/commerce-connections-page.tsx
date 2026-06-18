import React, { useEffect, useMemo, useState } from "react";
import { Link, RefreshCw, Trash2, Zap } from "lucide-react";
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

export function CommerceConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<CommerceConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage("Conexao criada.");
    } catch (e) {
      setMessage(readError(e));
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
    } catch (e) {
      setMessage(readError(e));
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
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteConnection(id: string) {
    if (!window.confirm("Remover esta conexao de commerce?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteCommerceConnection(id);
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setMessage("Conexao removida.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Conexoes de commerce</h1>
        <p className="page-lead">Login necessario para gerenciar integracoes de loja.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Conexoes de commerce</h1>
          <p className="page-lead">Integre com Shopify, WooCommerce, VTEX e outras plataformas.</p>
        </div>
        <button type="button" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}
      {loading ? <p className="panel panel-info">Carregando...</p> : null}

      {/* Add connection form */}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Nova conexao</h2>
          <Link size={18} />
        </div>
        <form onSubmit={(e) => void createConnection(e)} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label>
            Plataforma
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={busy}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dominio da loja
            <input
              type="text"
              placeholder="minhaloja.myshopify.com"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy} style={{ alignSelf: "flex-end" }}>
            <Zap size={16} />
            Conectar
          </button>
        </form>
      </section>

      {/* Connections table */}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Conexoes ativas</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th>Dominio</th>
                <th>Status</th>
                <th>Atualizado</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id}>
                  <td>{conn.platform}</td>
                  <td>
                    <code>{conn.shop_domain ?? "—"}</code>
                  </td>
                  <td>
                    <span className={conn.status === "active" ? "badge ok" : "badge bad"}>
                      {conn.status}
                    </span>
                  </td>
                  <td>{formatDate(conn.updated_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void testConnection(conn.id)}
                        title="Testar"
                      >
                        <Zap size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void syncConnection(conn.id)}
                        title="Sincronizar"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteConnection(conn.id)}
                        title="Remover"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {connections.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5}>Nenhuma conexao configurada.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
