"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBuyerOrders, submitReturnRequest, type BuyerOrderOption } from "@/lib/services/support.service";

interface ReturnRequestFormProps {
  orderId?: string;
  merchantId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const REASONS = [
  { value: "DEFECTIVE", label: "Produto com defeito" },
  { value: "WRONG_ITEM", label: "Recebi item errado" },
  { value: "NOT_AS_DESCRIBED", label: "Diferente do anúncio" },
  { value: "CHANGED_MIND", label: "Mudei de ideia" },
  { value: "DAMAGED_IN_TRANSIT", label: "Danificado no transporte" },
  { value: "OTHER", label: "Outro motivo" },
];

export function ReturnRequestForm({ orderId: initialOrderId, merchantId, onSuccess, onCancel }: ReturnRequestFormProps) {
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [orders, setOrders] = useState<BuyerOrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId ?? "");
  const [orderSearch, setOrderSearch] = useState("");

  useEffect(() => {
    let active = true;
    setOrdersLoading(true);
    fetchBuyerOrders(merchantId)
      .then((list) => {
        if (!active) return;
        setOrders(list);
        if (!initialOrderId && list.length === 1) setSelectedOrderId(list[0].order_id);
      })
      .finally(() => {
        if (active) setOrdersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [merchantId, initialOrderId]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) => o.order_id.toLowerCase().includes(q) || o.merchant_name.toLowerCase().includes(q),
    );
  }, [orders, orderSearch]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newImages: string[] = [];
    for (let i = 0; i < Math.min(files.length, 3 - images.length); i++) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          newImages.push(ev.target.result as string);
          if (newImages.length === Math.min(files.length, 3 - images.length)) {
            setImages((prev) => [...prev, ...newImages]);
          }
        }
      };
      reader.readAsDataURL(files[i]);
    }
  };

  const handleSubmit = async () => {
    if (!reason || !title.trim()) {
      setError("Preencha o motivo e o título");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await submitReturnRequest({
        orderId: selectedOrderId.trim() || undefined,
        merchantId,
        reason,
        title: title.trim(),
        description: description.trim(),
        items: [{ variantId: "all", quantity: 1, reason }],
        images,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 0" }}>
      <h3 style={{ font: "600 15px var(--aacp-font, system-ui)", color: "var(--aacp-fg, #f5f5f7)", margin: 0 }}>
        Solicitar devolução
      </h3>
      <p style={{ font: "12px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", margin: 0, lineHeight: 1.5 }}>
        Prazo de 14 dias após a compra
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ font: "500 11px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Pedido
        </label>
        {ordersLoading ? (
          <span style={{ font: "12px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)" }}>Carregando seus pedidos...</span>
        ) : orders.length === 0 ? (
          <span style={{ font: "12px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)" }}>
            Nenhum pedido encontrado nesta loja. Você pode seguir sem vincular.
          </span>
        ) : (
          <>
            {orders.length > 5 && (
              <input
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Buscar por número do pedido..."
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))", background: "var(--aacp-surface, #1a1a1a)", color: "var(--aacp-fg, #f5f5f7)", font: "13px var(--aacp-font, system-ui)", marginBottom: 6 }}
              />
            )}
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))", background: "var(--aacp-surface, #1a1a1a)", color: "var(--aacp-fg, #f5f5f7)", font: "13px var(--aacp-font, system-ui)" }}
            >
              <option value="">Sem pedido vinculado</option>
              {filteredOrders.map((o) => (
                <option key={o.id} value={o.order_id}>
                  {o.order_id}{o.created_at ? ` · ${new Date(o.created_at).toLocaleDateString("pt-BR")}` : ""}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Motivo */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ font: "500 11px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Motivo *
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))", background: "var(--aacp-surface, #1a1a1a)", color: "var(--aacp-fg, #f5f5f7)", font: "13px var(--aacp-font, system-ui)" }}
        >
          <option value="">Selecione...</option>
          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Título */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ font: "500 11px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Título *
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Produto chegou com defeito na tela"
          style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))", background: "var(--aacp-surface, #1a1a1a)", color: "var(--aacp-fg, #f5f5f7)", font: "13px var(--aacp-font, system-ui)" }}
        />
      </div>

      {/* Descrição */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ font: "500 11px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Descrição
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Descreva o problema em detalhes..."
          style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))", background: "var(--aacp-surface, #1a1a1a)", color: "var(--aacp-fg, #f5f5f7)", font: "13px var(--aacp-font, system-ui)", resize: "vertical" }}
        />
      </div>

      {/* Imagens */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ font: "500 11px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Fotos (até 3)
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          disabled={images.length >= 3}
          style={{ font: "12px var(--aacp-font, system-ui)", color: "var(--aacp-muted, #8b8b95)" }}
        />
        {images.length > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={img} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))" }} />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#e11d48", color: "#fff", border: "none", font: "10px sans-serif", cursor: "pointer", display: "grid", placeItems: "center" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p style={{ font: "12px var(--aacp-font, system-ui)", color: "#e11d48", margin: 0 }}>{error}</p>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            font: "600 13px var(--aacp-font, system-ui)",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Enviando..." : "Solicitar devolução"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
            background: "transparent",
            color: "var(--aacp-muted, #8b8b95)",
            font: "500 13px var(--aacp-font, system-ui)",
            cursor: "pointer",
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
