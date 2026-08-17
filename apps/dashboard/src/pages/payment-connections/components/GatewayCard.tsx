import React from "react";
import type { PaymentConnection } from "../../../api-client.js";
import { formatDate } from "../usePaymentConnectionsPage.js";
import type { Operation } from "../usePaymentConnectionsPage.js";
import { StatusBadge } from "./StatusBadge.js";
import { ExternalLink, RefreshCw, PlugZap, Settings } from "lucide-react";
import { Button } from "../../../components/Button.js";

interface GatewayCardProps {
  provider: "stripe" | "asaas" | "crypto";
  name: string;
  description: string;
  iconBg: string;
  icon: React.ReactNode;
  connection: PaymentConnection | undefined;
  operation: Operation;
  connectingOperation: Operation;
  syncingOperation: Operation;
  onConnect: () => void;
  onSync: () => void;
  comingSoon?: boolean;
  configureUrl?: string;
}

export function GatewayCard({
  provider,
  name,
  description,
  iconBg,
  icon,
  connection,
  operation,
  connectingOperation,
  syncingOperation,
  onConnect,
  onSync,
  comingSoon,
  configureUrl,
}: GatewayCardProps) {
  const isConnected = !!connection;
  const status = connection?.status ?? "disconnected";
  const isMyConnecting = operation === connectingOperation;
  const isMySyncing = operation === syncingOperation;
  const disabled = operation !== "idle" || comingSoon;

  return (
    <section className="gateway-card" aria-labelledby={`gateway-${provider}`}>
      <div className="gateway-card__header">
        <div className="gateway-card__title-group">
          <div className="gateway-card__icon-container" style={{ background: iconBg }}>
            {icon}
          </div>
          <div className="gateway-card__info">
            <h3 id={`gateway-${provider}`} className="gateway-card__name">
              {name}
            </h3>
            <p className="gateway-card__description">{description}</p>
          </div>
        </div>
        <div>
          {comingSoon ? (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: 999,
              font: "600 11px var(--mono)",
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid var(--accent-line)",
            }}>
              Em breve
            </span>
          ) : (
            <StatusBadge status={status} />
          )}
        </div>
      </div>

      {isConnected && connection ? (
        <div className="gateway-card__status">
          {connection.account_id ? (
            <div className="gateway-card__status-row">
              <span className="gateway-card__status-label">Conta</span>
              <code className="gateway-card__status-value">{connection.account_id}</code>
            </div>
          ) : null}
          <div className="gateway-card__status-row">
            <span className="gateway-card__status-label">Última sincronização</span>
            <span className="gateway-card__status-value">{formatDate(connection.updated_at)}</span>
          </div>
        </div>
      ) : !comingSoon ? (
        <div className="gateway-card__empty">
          <PlugZap size={18} aria-hidden="true" />
          <p className="gateway-card__empty-text">Não conectado</p>
        </div>
      ) : (
        <div className="gateway-card__empty">
          <Settings size={18} aria-hidden="true" />
          <p className="gateway-card__empty-text">Disponível em breve</p>
        </div>
      )}

      <div className="gateway-card__actions">
        {comingSoon && !configureUrl ? null : comingSoon && configureUrl ? (
          <a
            href={configureUrl}
            className="gateway-card__button gateway-card__button--secondary"
            aria-label={`Configurar ${name}`}
          >
            <Settings size={14} aria-hidden="true" />
            Configurar
          </a>
        ) : isConnected ? (
          <Button
            variant="outline"
            disabled={!!disabled}
            onClick={onSync}
            aria-busy={isMySyncing}
            aria-label={`Sincronizar ${name}`}
            loading={isMySyncing}
            fullWidth
          >
            <RefreshCw size={14} aria-hidden="true" />
            {isMySyncing ? "Sincronizando..." : "Sincronizar"}
          </Button>
        ) : (
          <Button
            variant="primary"
            arrow
            disabled={!!disabled}
            onClick={onConnect}
            aria-busy={isMyConnecting}
            aria-label={`Conectar ${name}`}
            loading={isMyConnecting}
            fullWidth
          >
            <ExternalLink size={14} aria-hidden="true" />
            {isMyConnecting ? "Conectando..." : "Conectar provedor"}
          </Button>
        )}
      </div>
    </section>
  );
}
