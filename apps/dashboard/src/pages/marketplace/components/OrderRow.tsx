import React, { useState } from "react";
import type { MarketplaceOrderLineItem } from "../types.js";

interface OrderRowProps {
  orderId: string;
  storeName: string;
  item: MarketplaceOrderLineItem;
  onMarkShipped: (lineItemId: string, tracking: string) => Promise<void>;
  onMarkDelivered: (lineItemId: string) => Promise<void>;
}

export function OrderRow({
  orderId,
  storeName,
  item,
  onMarkShipped,
  onMarkDelivered,
}: OrderRowProps) {
  const [tracking, setTracking] = useState("");
  const [loadingShip, setLoadingShip] = useState(false);
  const [loadingDeliver, setLoadingDeliver] = useState(false);

  const handleShip = async () => {
    if (!tracking.trim()) return;
    setLoadingShip(true);
    try {
      await onMarkShipped(item.id, tracking);
      setTracking("");
    } finally {
      setLoadingShip(false);
    }
  };

  const handleDeliver = async () => {
    setLoadingDeliver(true);
    try {
      await onMarkDelivered(item.id);
    } finally {
      setLoadingDeliver(false);
    }
  };

  const statusLabel =
    item.status === "pending"
      ? "Pendente"
      : item.status === "shipped"
        ? "Enviado"
        : "Entregue";

  return (
    <tr>
      <td>
        <span className="marketplace-orders__order-id">{orderId}</span>
      </td>
      <td>
        <span className="marketplace-orders__store-name">{storeName}</span>
      </td>
      <td>{item.product_name}</td>
      <td>
        <span className="marketplace-orders__amount">
          {new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(item.total_price)}
        </span>
      </td>
      <td>
        <span
          className={`marketplace-orders__status marketplace-orders__status--${item.status}`}
        >
          {statusLabel}
        </span>
      </td>
      <td>
        <div className="marketplace-orders__actions">
          {item.status === "pending" && (
            <>
              <input
                type="text"
                placeholder="Rastreamento"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                style={{
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border)",
                  fontSize: "11px",
                  width: "100px",
                }}
              />
              <button
                className="marketplace-orders__action-btn"
                onClick={() => void handleShip()}
                disabled={!tracking.trim() || loadingShip}
              >
                {loadingShip ? "..." : "Enviar"}
              </button>
            </>
          )}
          {item.status === "shipped" && (
            <button
              className="marketplace-orders__action-btn"
              onClick={() => void handleDeliver()}
              disabled={loadingDeliver}
            >
              {loadingDeliver ? "..." : "Marcar Entregue"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
