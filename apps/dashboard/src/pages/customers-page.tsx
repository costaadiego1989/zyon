import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, UsersRound } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type DashboardOverview, type MerchantProfile } from "../api-client.js";

type CustomerRow = {
  globalUserId: string;
  name: string;
  email: string;
  phone: string;
  lastSessionId: string;
  lastSeen: string;
};

export function CustomersPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setRows([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!props.me) return;
    setBusy(true);
    setMessage(null);
    try {
      const overview = await api.getDashboardOverview(props.me.id);
      setRows(toCustomerRows(overview));
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Clientes</h1>
        <p className="page-lead">Login necessario.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="page-lead">Clientes recentes capturados no checkout.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Clientes recentes</h2>
          <UsersRound size={18} />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Telefone</th>
                <th>Global user</th>
                <th>Ultima sessao</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.globalUserId}:${row.lastSessionId}`}>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{row.phone}</td>
                  <td>
                    <code>{row.globalUserId}</code>
                  </td>
                  <td>{row.lastSessionId}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nenhum cliente recente.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function toCustomerRows(overview: DashboardOverview): CustomerRow[] {
  const rows = new Map<string, CustomerRow>();
  for (const session of overview.recent_sessions ?? []) {
    const customer = session.customer;
    if (!customer?.email && !customer?.phone && !customer?.fullName) continue;
    rows.set(session.globalUserId, {
      globalUserId: session.globalUserId,
      name: customer.fullName ?? "-",
      email: customer.email ?? "-",
      phone: customer.phone ?? "-",
      lastSessionId: session.sessionId,
      lastSeen: session.updatedAt
    });
  }
  return Array.from(rows.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
