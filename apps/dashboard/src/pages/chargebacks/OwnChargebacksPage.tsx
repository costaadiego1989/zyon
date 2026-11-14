import React, { useState } from "react";
import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { DataPanel } from "../../components/DataPanel.js";
import { useChargebacksPage, type OwnChargeback } from "./useChargebacksPage.js";
import "./chargebacks.css";

const STATUS_META: Record<OwnChargeback["disputeStatus"], { label: string; tone: string }> = {
  pending: { label: "Em análise", tone: "warning" },
  disputed: { label: "Em contestação", tone: "info" },
  won: { label: "Resolvido a favor", tone: "success" },
  lost: { label: "Resolvido contra", tone: "error" },
};
const providerLabel = (provider: string) =>
  (({ mercadopago: "Mercado Pago", asaas: "Asaas", stripe: "Stripe" } as Record<string, string>)[provider] ??
  provider);
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Não informado"
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
export function OwnChargebacksPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const { chargebacks, loading, error, refetch } = useChargebacksPage(props.apiBaseUrl, !!props.me);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = chargebacks.filter(
    (item) =>
      (status === "all" || item.disputeStatus === status) &&
      (provider === "all" || item.provider === provider) &&
      [item.orderId, item.paymentIntentId, item.disputeReason]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  );
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  const clear = () => {
    setSearch("");
    setStatus("all");
    setProvider("all");
    setPage(1);
  };
  if (!props.me)
    return (
      <PageHeader
        title="Contestações de pagamento"
        description="Faça login para acompanhar as contestações da sua loja."
      />
    );
  return (
    <div className="page-container own-chargebacks-page">
      <PageHeader
        title="Contestações de pagamento"
        description="Acompanhe pedidos contestados e o estado informado pelo provedor de pagamento."
        actions={
          <Button variant="outline" onClick={() => void refetch()} disabled={loading}>
            <RefreshCw size={16} /> Atualizar
          </Button>
        }
      />
      <p className="chargebacks-help">
        Esta página permite consultar as contestações. Para enviar documentos ou acompanhar prazos de defesa,
        acesse o provedor responsável pelo pagamento.
      </p>
      {loading ? (
        <PageLoader variant="section" />
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="Contestações indisponíveis"
          description={error}
          action={<Button onClick={() => void refetch()}>Tentar novamente</Button>}
        />
      ) : (
        <>
          <FilterToolbar
            tabs={[
              { key: "all", label: "Todas" },
              { key: "pending", label: "Em análise" },
              { key: "disputed", label: "Em contestação" },
              { key: "won", label: "A favor" },
              { key: "lost", label: "Contra" },
            ]}
            activeTab={status}
            onTabChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchPlaceholder="Buscar pedido ou motivo"
            extra={
              <FilterSelect
                value={provider}
                onChange={(value) => {
                  setProvider(value);
                  setPage(1);
                }}
                ariaLabel="Provedor do pagamento"
                options={[
                  { value: "all", label: "Todos os provedores" },
                  ...[...new Set(chargebacks.map((item) => item.provider))]
                    .sort()
                    .map((value) => ({ value, label: providerLabel(value) })),
                ]}
              />
            }
          />
          <DataPanel
            title="Contestações registradas"
            page={safePage}
            pageSize={10}
            total={filtered.length}
            onPageChange={setPage}
            isEmpty={!filtered.length}
            empty={{
              icon: ShieldAlert,
              title: chargebacks.length
                ? "Nenhuma contestação com estes filtros"
                : "Nenhuma contestação registrada",
              description: chargebacks.length
                ? "Ajuste a busca ou limpe os filtros para ver os registros."
                : "As contestações informadas pelos provedores de pagamento aparecerão aqui.",
              action: chargebacks.length ? (
                <Button variant="outline" onClick={clear}>
                  Limpar filtros
                </Button>
              ) : undefined,
            }}
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Provedor</th>
                    <th>Motivo</th>
                    <th>Aberta em</th>
                    <th className="chargebacks-amount">Valor</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((safePage - 1) * 10, safePage * 10).map((item) => {
                    const meta = STATUS_META[item.disputeStatus] ?? {
                      label: "Aguardando atualização",
                      tone: "info",
                    };
                    return (
                      <tr key={item.paymentIntentId}>
                        <td>
                          <code>{item.orderId || item.paymentIntentId}</code>
                        </td>
                        <td>{providerLabel(item.provider)}</td>
                        <td>{item.disputeReason || "Não informado pelo provedor"}</td>
                        <td>{formatDate(item.disputeOpenedAt)}</td>
                        <td className="chargebacks-amount">
                          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                            item.amountCents / 100
                          )}
                        </td>
                        <td>
                          <span className={`chargebacks-status chargebacks-status--${meta.tone}`}>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DataPanel>
        </>
      )}
    </div>
  );
}
