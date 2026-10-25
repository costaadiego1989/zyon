import React, { useState } from "react";
import type { MarketplaceOrderLineItem } from "../types.js";
import { Modal } from "../../../components/Modal.js";
import { FormField } from "../../../components/FormField.js";
import { Button } from "../../../components/Button.js";
interface Props {
  orderId: string;
  storeName: string;
  item: MarketplaceOrderLineItem;
  onMarkShipped: (id: string, tracking: string) => Promise<boolean>;
  onMarkDelivered: (id: string) => Promise<boolean>;
}
export function OrderRow({ orderId, storeName, item, onMarkShipped, onMarkDelivered }: Props) {
  const [tracking, setTracking] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const shipping = item.status === "pending";
  const close = () => {
    if (busy) return;
    if (tracking.trim()) {
      setDiscard(true);
      return;
    }
    setOpen(false);
    setError(null);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = shipping ? await onMarkShipped(item.id, tracking.trim()) : await onMarkDelivered(item.id);
    setBusy(false);
    if (ok) {
      setTracking("");
      setOpen(false);
    } else setError("Não foi possível confirmar. Os dados foram preservados; tente novamente.");
  };
  return (
    <tr>
      <td>
        <span className="marketplace-orders__order-id">{orderId}</span>
      </td>
      <td>{storeName}</td>
      <td>{item.product_name}</td>
      <td>
        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.total_price)}
      </td>
      <td>
        <span className={`marketplace-orders__status marketplace-orders__status--${item.status}`}>
          {shipping ? "Pendente" : item.status === "shipped" ? "Enviado" : "Entregue"}
        </span>
      </td>
      <td>
        {item.status !== "delivered" && (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              setDiscard(false);
              setError(null);
            }}
          >
            {shipping ? "Registrar envio" : "Confirmar entrega"}
          </Button>
        )}
        <Modal
          isOpen={open}
          title={shipping ? "Registrar envio" : "Confirmar entrega"}
          subtitle={`Pedido ${orderId}`}
          presentation="center"
          size="lg"
          onClose={close}
          footer={
            discard ? (
              <>
                <Button variant="outline" onClick={() => setDiscard(false)}>
                  Continuar editando
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setTracking("");
                    setOpen(false);
                    setDiscard(false);
                  }}
                >
                  Descartar e fechar
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={close}>
                  Cancelar
                </Button>
                <Button
                  disabled={busy || (shipping && !tracking.trim())}
                  loading={busy}
                  onClick={() => void save()}
                >
                  {shipping ? "Confirmar envio" : "Confirmar entrega"}
                </Button>
              </>
            )
          }
        >
          <div className="configuration-form marketplace-shipping-form">
            <p className="marketplace-help">
              <strong>{item.product_name}</strong>
              <br />
              {shipping
                ? "Informe o código de rastreamento após despachar o produto. O pedido será marcado como enviado."
                : "Confirme somente após verificar que o produto foi entregue ao comprador."}
            </p>
            {shipping && (
              <FormField
                label="Código de rastreamento"
                value={tracking}
                onChange={setTracking}
                disabled={busy}
                placeholder="Ex.: AA123456789BR"
              />
            )}
            {error && (
              <p className="marketplace-error" role="alert">
                {error}
              </p>
            )}
            {discard && <p className="marketplace-help">O rastreamento informado ainda não foi salvo.</p>}
          </div>
        </Modal>
      </td>
    </tr>
  );
}
