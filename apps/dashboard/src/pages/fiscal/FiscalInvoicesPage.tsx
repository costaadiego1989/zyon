import React, { useEffect, useMemo, useState } from "react";
import { createDashboardApi } from "../../api-client.js";
import { fiscalDashboardEnvironment } from "../../lib/fiscal-environment.js";
import type {
  FiscalEnvironment,
  FiscalInvoiceRow,
  FiscalInvoicePage,
  FiscalState,
  FiscalDelivery,
} from "../../api/fiscal.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { FormField, FormSelect } from "../../components/FormField.js";
import { Button } from "../../components/Button.js";
import { Pagination } from "../../components/Pagination.js";
import { EmptyState } from "../../components/EmptyState.js";
import { fiscalErrorText, providerLabels } from "./fiscal-ui.js";
import "../../components/configuration-form.css";
import "./fiscal.css";
export const fiscalStateLabels: Record<FiscalState, string> = {
  awaiting_payment: "Aguardando pagamento",
  not_eligible_before_activation: "Venda anterior à ativação",
  queued: "Na fila",
  processing: "Em processamento",
  reconciliation_required: "Aguardando confirmação do emissor",
  action_required: "Ação necessária",
  rejected: "Rejeitada",
  authorized: "Autorizada",
  cancelled: "Cancelada",
  suppressed: "Emissão suprimida",
};
export const fiscalDeliveryLabels: Record<FiscalDelivery["state"], string> = {
  queued: "Na fila",
  blocked: "Bloqueado",
  accepted: "Aceito pelo canal",
  delivered: "Entregue",
  failed: "Falhou",
  delivery_unknown: "Resultado de entrega incerto",
};
export function FiscalInvoiceCounts({
  total,
  counts,
}: {
  total: number;
  counts: FiscalInvoicePage["counts"];
}) {
  return (
    <div className="fiscal-counts" aria-label="Contagens do servidor">
      <strong>{total.toLocaleString("pt-BR")} notas e pendências</strong>
      {Object.entries(counts).map(([state, count]) => (
        <span key={state}>
          {fiscalStateLabels[state as FiscalState]}:{" "}
          {count!.toLocaleString("pt-BR")}
        </span>
      ))}
    </div>
  );
}
export function FiscalInvoiceRows({
  rows,
  onOpen,
}: {
  rows: FiscalInvoiceRow[];
  onOpen: (id: string) => void;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="Nenhuma nota encontrada"
        description="As notas de novas vendas elegíveis aparecerão aqui. Ajuste a busca ou o ambiente para consultar outros resultados."
      />
    );
  return (
    <div className="fiscal-table-scroll">
      <table className="fiscal-table">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Destinatário</th>
            <th>Emissor</th>
            <th>Estado fiscal</th>
            <th>Entregas</th>
            <th>Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.orderId}</td>
              <td>{row.recipientName}</td>
              <td>{providerLabels[row.provider]}</td>
              <td>{fiscalStateLabels[row.state]}</td>
              <td>
                {row.deliveries.length
                  ? row.deliveries.map((d) => (
                      <div key={d.channel}>
                        {d.channel === "email" ? "E-mail" : "WhatsApp"}:{" "}
                        {fiscalDeliveryLabels[d.state]}
                      </div>
                    ))
                  : "Sem entrega registrada"}
              </td>
              <td>
                <Button
                  variant="outline"
                  onClick={() => onOpen(row.id)}
                  aria-label={`Abrir nota do pedido ${row.orderId}`}
                >
                  Ver nota
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FiscalInvoicesPage({
  apiBaseUrl,
  merchantId,
  onOpen = () => {},
  initialEnvironment = "homologation",
  onSettings,
}: {
  apiBaseUrl: string;
  merchantId: string | null;
  onOpen?: (id: string, environment: FiscalEnvironment) => void;
  initialEnvironment?: FiscalEnvironment;
  onSettings?: () => void;
}) {
  const api = useMemo(
    () => createDashboardApi({ baseUrl: apiBaseUrl }),
    [apiBaseUrl]
  );
  const [selectedEnvironment, setEnvironment] =
      useState<FiscalEnvironment>(initialEnvironment),
    [search, setSearch] = useState(""),
    [applied, setApplied] = useState(""),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<FiscalInvoicePage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const environment = fiscalDashboardEnvironment(selectedEnvironment);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    setError("");
    if (!merchantId) {
      setLoading(false);
      return;
    }
    void api
      .getFiscalInvoices(environment, {
        search: applied || undefined,
        state: (state as FiscalState) || undefined,
        page,
        pageSize: 20,
      })
      .then((result) => {
        if (live) setData(result);
      })
      .catch((e) => {
        if (live) setError(fiscalErrorText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, merchantId, environment, applied, state, page, revision]);
  return (
    <div className="fiscal-page">
      <PageHeader
        title="Notas fiscais"
        description="Veja quais notas foram autorizadas, o que precisa de atenção e se o comprador recebeu os arquivos."
        actions={
          onSettings && (
            <Button variant="outline" onClick={onSettings}>
              Configurar emissão
            </Button>
          )
        }
      />
      <SetupGuide
        title="Como acompanhar suas notas"
        steps={[
          {
            title: "Encontre o pedido",
            description:
              "Busque pelo pedido ou pelo comprador para acompanhar as notas das suas vendas.",
          },
          {
            title: "Confira a nota e o envio separadamente",
            description:
              "Autorizada significa que o emissor confirmou a nota. E-mail e WhatsApp mostram se a mensagem foi aceita ou entregue ao comprador.",
          },
          {
            title: "Abra o detalhe para resolver pendências",
            description:
              "Use Ver nota para baixar os arquivos e ver a próxima ação. Quando faltar uma confirmação do emissor, consulte o resultado no detalhe.",
          },
        ]}
      />
      {!merchantId ? (
        <p role="alert">Faça login para consultar suas notas.</p>
      ) : (
        <>
          <form
            className="configuration-form"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setApplied(search.trim());
            }}
          >
            <div className="configuration-form__grid">
              {!import.meta.env.PROD && <FormSelect
                label="Ambiente fiscal"
                value={environment}
                onChange={(v) => {
                  setEnvironment(v as FiscalEnvironment);
                  setPage(1);
                }}
                options={[
                  {
                    value: "homologation",
                    label: "Homologação · sem validade fiscal",
                  },
                  { value: "production", label: "Produção" },
                ]}
              />}
              <FormSelect
                label="Estado fiscal"
                value={state}
                onChange={(v) => {
                  setState(v);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "Todos os estados" },
                  ...Object.entries(fiscalStateLabels).map(
                    ([value, label]) => ({ value, label })
                  ),
                ]}
              />
              <FormField
                label="Buscar pedido ou destinatário"
                value={search}
                onChange={setSearch}
              />
            </div>
            <div className="fiscal-actions">
              <Button type="submit">Buscar notas</Button>
              <Button
                variant="outline"
                onClick={() => setRevision((v) => v + 1)}
                disabled={loading}
              >
                Atualizar notas
              </Button>
            </div>
          </form>
          {loading ? (
            <p role="status">Carregando notas…</p>
          ) : error ? (
            <div role="alert" className="fiscal-state">
              <p>{error}</p>
              <Button
                variant="outline"
                onClick={() => setRevision((v) => v + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            data && (
              <>
                <FiscalInvoiceCounts total={data.total} counts={data.counts} />
                <FiscalInvoiceRows
                  rows={data.items}
                  onOpen={(id) => onOpen(id, environment)}
                />
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onChange={setPage}
                />
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
