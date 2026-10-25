import React, { useEffect, useRef, useState } from "react";
import { Search, Store, Loader2 } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { reportError } from "../../../hooks/useErrorReporter.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

interface PartnerStore {
  merchantId: string;
  storeName: string;
}

interface PartnerStoreDropdownProps {
  api: DashboardApi;
  ticketId: string;
  onTransferred: (storeName: string) => void;
}

export function PartnerStoreDropdown({ api, ticketId, onTransferred }: PartnerStoreDropdownProps) {
  const [query, setQuery] = useState("");
  const [stores, setStores] = useState<PartnerStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<PartnerStore | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const transferInFlight = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchStores(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function fetchStores(q: string) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.listPartnerStores(q || undefined);
      if (current !== request.current) return;
      setStores(result.stores ?? []);
      setActiveIndex(-1);
    } catch (e) {
      reportError({ source: "PartnerStoreDropdown.fetchStores", error: e });
      if (current === request.current) { setStores([]); setError("Não foi possível carregar as lojas parceiras. Tente novamente."); }
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  async function handleConfirmTransfer(store: PartnerStore) {
    if (transferInFlight.current) return;
    transferInFlight.current = true;
    setTransferring(true);
    setError(null);
    try {
      await api.transferTicket(ticketId, store.merchantId);
      onTransferred(store.storeName);
    } catch (e) {
      reportError({ source: "PartnerStoreDropdown.transferTicket", error: e });
      setError("A transferência não foi confirmada. Confira o chamado antes de tentar novamente.");
    } finally {
      setTransferring(false);
      transferInFlight.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!stores.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, stores.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      setConfirming(stores[activeIndex]);
    }
  }

  if (confirming) {
    return (
      <div
        className="partner-store-dropdown"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "12px",
          backgroundColor: "var(--color-surface-raised)",
        }}
      >
        <p style={{ fontSize: "13px", color: "var(--color-text)", margin: "0 0 12px" }}>
          Transferir chamado para <strong>{confirming.storeName}</strong>?
        </p>
        {error && <p className="panel-error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button
            variant="primary"
            size="sm"
            loading={transferring}
            onClick={() => handleConfirmTransfer(confirming)}
          >
            Confirmar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={transferring}
            onClick={() => setConfirming(null)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="partner-store-dropdown"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "12px",
        backgroundColor: "var(--color-surface-raised)",
      }}
    >
      <label
        htmlFor="partner-store-search"
        style={{
          display: "block",
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "none",
          color: "var(--color-text-muted)",
          marginBottom: "6px",
        }}
      >
        Vincular loja parceira
      </label>
      <div style={{ position: "relative", marginBottom: "8px" }}>
        <Search
          size={14}
          style={{
            position: "absolute",
            left: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--color-text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          id="partner-store-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar loja..."
          role="combobox"
          aria-expanded={stores.length > 0}
          aria-controls="partner-store-listbox"
          aria-autocomplete="list"
          style={{
            width: "100%",
            padding: "8px 12px 8px 32px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: "13px",
          }}
        />
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "12px",
            color: "var(--color-text-muted)",
            fontSize: "12px",
          }}
        >
          <Loader2 size={14} className="spin" />
          Carregando...
        </div>
      ) : error ? <div className="panel-error" role="alert">{error}<Button variant="outline" size="sm" onClick={() => void fetchStores(query)}>Tentar novamente</Button></div> : stores.length === 0 ? (
        <div
          style={{
            padding: "12px",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: "12px",
          }}
        >
          Nenhuma loja encontrada.
        </div>
      ) : (
        <ul
          id="partner-store-listbox"
          role="listbox"
          aria-label="Lojas parceiras"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: "180px",
            overflowY: "auto",
          }}
        >
          {stores.map((store, idx) => (
            <li
              key={store.merchantId}
              role="option"
              aria-selected={idx === activeIndex}
            >
              <button
                type="button"
                onClick={() => setConfirming(store)}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: idx === activeIndex ? "var(--color-surface-alt)" : "transparent",
                  color: "var(--color-text)",
                  fontSize: "13px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Store size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {store.storeName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
