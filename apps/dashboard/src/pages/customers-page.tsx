import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, UsersRound } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantProfile,
  type TenantCustomer,
} from "../api-client.js";

type CustomerRow = {
  globalUserId: string;
  name: string;
  email: string;
  phone: string;
  lastSeen: string;
};

export function CustomersPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // BUG-BPH-1 (P2): Track loading state separately from busy so the empty-state
  // row is hidden while the initial fetch is in flight. Without this flag,
  // "Nenhum cliente recente." flashes during load before data arrives.
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    setMessage(null);
    try {
      setRows(toCustomerRows(await api.getCustomers(100)));
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Clientes</h1>
            <p className="page-lead">Login necessario.</p>
          </div>
        </header>
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
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-error">{message}</p> : null}

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Clientes recentes</h2>
          <UsersRound size={18} />
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="skeleton" style={{ width: "100%", height: 200 }} />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Telefone</th>
                    <th>Global user</th>
                    <th>Ultima atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.globalUserId}>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td>{row.phone}</td>
                      <td>
                        <code>{row.globalUserId}</code>
                      </td>
                      <td>{formatDate(row.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* BUG-BPH-1 (P2): Only show empty-state after loading completes. */}
            {rows.length === 0 && !loading ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <UsersRound size={32} />
                </div>
                <h3>Nenhum cliente recente</h3>
                <p>Clientes que interagirem com o checkout aparecerão aqui.</p>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function toCustomerRows(customers: TenantCustomer[]): CustomerRow[] {
  return customers.map((customer) => ({
    globalUserId: customer.id,
    name: text(customer.profile.full_name),
    email: text(customer.profile.email),
    phone: text(customer.profile.phone),
    lastSeen: customer.last_seen_at,
  }));
}

function text(value: unknown): string {
  return typeof value === "string" && value ? value : "-";
}

/**
 * BUG-BPH-2 (P3): Guard against absent or malformed date values.
 * `new Date(undefined)` / `new Date("")` produce an Invalid Date that formats
 * as "Invalid Date". Returning "-" for missing/invalid values is safe and
 * matches the sentinel used for other optional string fields.
 */
function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
