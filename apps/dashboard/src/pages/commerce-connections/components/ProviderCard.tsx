import React from "react";
import { AlertCircle, CheckCircle2, Clock, ShoppingBag, Trash2, RefreshCw, Zap } from "lucide-react";
import type { CommerceConnection } from "../../../api-client.js";
import { Button } from "../../../components/Button.js";
import type { Operation } from "../hooks/useCommerceConnections.js";

// ─ Constants ────────────────────────────────────────────────────────────────

export const PROVIDER_LABELS: Record<string, string> = {
  native: "Integração Nativa (Embed)",
  woocommerce: "WooCommerce",
  magento: "Magento / Adobe Commerce",
};

// ─ Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function statusBadge(status: string) {
  if (status === "healthy")
    return <span className="badge ok"><CheckCircle2 size={11} /> Ativo</span>;
  if (status === "degraded")
    return <span className="badge bad"><AlertCircle size={11} /> Erro de sincronização</span>;
  return <span className="badge warn"><Clock size={11} /> Pendente</span>;
}

function statusAccentClass(status: string): string {
  if (status === "healthy") return "commerce-status-accent--healthy";
  if (status === "degraded") return "commerce-status-accent--degraded";
  return "commerce-status-accent--pending";
}

// ─ Props ────────────────────────────────────────────────────────────────────

export interface ProviderCardProps {
  connection: CommerceConnection;
  operation: Operation;
  isBusy: boolean;
  onTest: () => void;
  onSync: () => void;
  onDelete: () => void;
}

// ─ Component ────────────────────────────────────────────────────────────────

export function ProviderCard({
  connection,
  operation,
  isBusy,
  onTest,
  onSync,
  onDelete,
}: ProviderCardProps) {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  return (
    <article
      className={`panel stacked commerce-connection-card ${statusAccentClass(connection.status)}`}
    >
      <div className="commerce-card-body">
        {/* Platform icon */}
        <div className="commerce-card-icon">
          <ShoppingBag size={18} />
        </div>

        {/* Main info */}
        <div className="commerce-card-info">
          <div className="commerce-card-title-row">
            <strong>{PROVIDER_LABELS[connection.provider] ?? connection.provider}</strong>
            {statusBadge(connection.status)}
            {connection.api_version ? (
              <span className="badge muted">v{connection.api_version}</span>
            ) : null}
            {connection.last_error_code ? (
              <span className="badge bad" title={connection.last_error_code}>{connection.last_error_code}</span>
            ) : null}
          </div>
          <div className="commerce-card-meta">
            <span className="commerce-card-url">{connection.store_url}</span>
            {connection.last_tested_at ? (
              <span className="commerce-card-date">Testado {formatDate(connection.last_tested_at)}</span>
            ) : null}
            {connection.last_synced_at ? (
              <span className="commerce-card-date">Sincronizado {formatDate(connection.last_synced_at)}</span>
            ) : null}
            <span className="commerce-card-date">Atualizado {formatDate(connection.updated_at)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="commerce-actions">
          {confirmingDelete ? (
            <>
              <span className="commerce-confirm-text">Tem certeza?</span>
              <Button
                variant="ghost"
                disabled={operation === "deleting"}
                onClick={() => {
                  onDelete();
                  setConfirmingDelete(false);
                }}
              >
                <Trash2 size={14} style={{ marginRight: 6 }} />
                {operation === "deleting" ? "Removendo..." : "Confirmar"}
              </Button>
              <Button
                variant="ghost"
                disabled={operation === "deleting"}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={onTest}
              >
                <Zap size={14} style={{ marginRight: 6 }} />
                {operation === "testing" ? "Testando..." : "Testar"}
              </Button>
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={onSync}
              >
                <RefreshCw size={14} style={{ marginRight: 6 }} />
                {operation === "syncing" ? "Sincronizando..." : "Sincronizar agora"}
              </Button>
              <Button
                variant="ghost"
                disabled={isBusy}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={14} style={{ marginRight: 6 }} />
                Remover conexão
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
