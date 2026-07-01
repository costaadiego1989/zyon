import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type AuditEvent,
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

function actionBadgeClass(action: string): string {
  if (/delete|remove|revoke|disable/i.test(action)) return "badge bad";
  if (/create|add|enable|approve/i.test(action)) return "badge ok";
  if (/update|edit|change|modify/i.test(action)) return "badge warn";
  return "badge muted";
}

export function AuditLogPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.me) {
      setEvents([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      setEvents(await api.getAuditEvents(100));
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setLoading(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Auditoria</h1>
            <p className="page-lead">Login necessario para acessar o log de auditoria.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Log de auditoria</h1>
          <p className="page-lead">Registro de acoes administrativas do tenant (compliance/seguranca).</p>
        </div>
        <div className="button-row">
          <button type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-warn">{message}</p> : null}

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Eventos recentes</h2>
          <ShieldCheck size={18} />
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
                    <th>Data</th>
                    <th>Acao</th>
                    <th>Recurso</th>
                    <th>ID recurso</th>
                    <th>Ator</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr key={evt.id}>
                      <td>{formatDate(evt.created_at)}</td>
                      <td>
                        <span className={actionBadgeClass(evt.action)}>
                          <code>{evt.action}</code>
                        </span>
                      </td>
                      <td>{evt.resource_type}</td>
                      <td>
                        <code>{evt.resource_id ?? "—"}</code>
                      </td>
                      <td>
                        <code>{evt.actor_id ?? "sistema"}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {events.length === 0 && !loading ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <ShieldCheck size={32} />
                </div>
                <h3>Nenhum evento de auditoria</h3>
                <p>Acoes administrativas do tenant serao registradas aqui para fins de compliance.</p>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
