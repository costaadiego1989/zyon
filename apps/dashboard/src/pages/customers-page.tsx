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
      setRows(toCustomerRows(await api.getCustomers(100)));
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
