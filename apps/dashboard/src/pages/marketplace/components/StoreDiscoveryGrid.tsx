import React, { useEffect, useState, useCallback } from "react";
import { Search, Store } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import type { AvailableStore } from "../../../api/endpoints/marketplace-v2.js";

interface StoreDiscoveryGridProps {
  apiBaseUrl: string;
}

const DEFAULT_NICHES = [
  "Moda", "Eletrônicos", "Casa & Decoração", "Beleza", "Esportes",
  "Alimentos", "Pet", "Livros", "Brinquedos", "Saúde",
];

export function StoreDiscoveryGrid({ apiBaseUrl }: StoreDiscoveryGridProps) {
  const api = useApi();
  const [stores, setStores] = useState<AvailableStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Derive categories from stores (with fallback to defaults)
  const categories = stores.length > 0
    ? [...new Set(stores.map((s) => s.category))].sort()
    : DEFAULT_NICHES;

  // Load initial stores
  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = useCallback(async (cursor?: string) => {
    setSearching(true);
    try {
      const result = await api.listAvailableStores({
        category: selectedCategory || undefined,
        search: searchTerm || undefined,
        limit: 20,
        cursor,
      });
      if (cursor) {
        setStores((prev) => [...prev, ...result.stores]);
      } else {
        setStores(result.stores);
      }
      setNextCursor(result.nextCursor);
    } catch (err) {
      reportError({ source: "store_discovery.loadStores", error: err, severity: "warning" });
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [api, selectedCategory, searchTerm]);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    setLoading(true);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        loadStores();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [loading, loadStores]);

  const handleCategoryChange = useCallback((cat: string | null) => {
    setSelectedCategory(cat);
    setLoading(true);
  }, []);

  // Reload when category changes
  useEffect(() => {
    loadStores();
  }, [selectedCategory]);

  const handleConnect = async (storeId: string) => {
    setConnecting(storeId);
    try {
      await api.connectStore(storeId);
      setStores((prev) =>
        prev.map((s) => (s.id === storeId ? { ...s, connected: true } : s))
      );
      showToast("success", "Loja habilitada com sucesso");
    } catch (err) {
      reportError({ source: "store_discovery.connectStore", error: err, severity: "warning" });
      showToast("error", "Erro ao habilitar loja");
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (storeId: string) => {
    setConnecting(storeId);
    try {
      await api.disconnectStore(storeId);
      setStores((prev) =>
        prev.map((s) => (s.id === storeId ? { ...s, connected: false } : s))
      );
      showToast("success", "Loja desabilitada com sucesso");
    } catch (err) {
      reportError({ source: "store_discovery.disconnectStore", error: err, severity: "warning" });
      showToast("error", "Erro ao desabilitar loja");
    } finally {
      setConnecting(null);
    }
  };

  if (loading && stores.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
          Carregando lojas...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Search Bar */}
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-faint)", pointerEvents: "none" }} />
        <input
          type="text"
          placeholder="Buscar lojas por nome..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 14px 10px 38px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--surface-2)",
            color: "var(--color-text)",
            font: "13px var(--font-sans)",
          }}
        />
      </div>

      {/* Category Filter Chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => handleCategoryChange(null)}
          style={{
            padding: "5px 12px",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--color-border)",
            background: selectedCategory === null ? "var(--color-brand)" : "transparent",
            color: selectedCategory === null ? "#fff" : "var(--color-text-muted)",
            font: "500 11px var(--font-sans)",
            cursor: "pointer",
          }}
        >
          Todas
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => handleCategoryChange(cat)}
            style={{
              padding: "5px 12px",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--color-border)",
              background: selectedCategory === cat ? "var(--color-brand)" : "transparent",
              color: selectedCategory === cat ? "#fff" : "var(--color-text-muted)",
              font: "500 11px var(--font-sans)",
              cursor: "pointer",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Stores Grid or Empty */}
      {stores.length === 0 ? (
        <EmptyState
          icon={Store}
          title={searchTerm || selectedCategory ? "Nenhuma loja encontrada" : "Nenhuma loja disponível"}
          description={searchTerm || selectedCategory ? "Tente ajustar seus filtros de busca" : "Não há lojas parceiras disponíveis no momento"}
        />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {stores.map((store) => (
              <div key={store.id} style={{ padding: "16px", background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Logo + Info */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", background: "var(--color-brand)", color: "#fff", display: "grid", placeItems: "center", font: "600 16px var(--font-sans)", flexShrink: 0 }}>
                    {store.logoUrl ? <img src={store.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", objectFit: "cover" }} /> : store.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{store.name}</div>
                    <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 2 }}>
                      {store.category} · {store.commissionPercent}% comissão
                    </div>
                  </div>
                </div>

                {/* Status + Action */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {store.connected ? (
                    <span style={{ padding: "3px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)" }}>Habilitada</span>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={() => store.connected ? handleDisconnect(store.id) : handleConnect(store.id)}
                    disabled={connecting === store.id}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: store.connected ? "transparent" : "var(--color-brand)",
                      color: store.connected ? "var(--color-text-muted)" : "#fff",
                      font: "500 11px var(--font-sans)",
                      cursor: "pointer",
                    }}
                  >
                    {connecting === store.id ? "..." : store.connected ? "Desconectar" : "Habilitar"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Load More */}
          {nextCursor && (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
              <button
                type="button"
                className="zyn-btn"
                onClick={() => loadStores(nextCursor)}
                disabled={searching}
                style={{ padding: "8px 20px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--color-text-muted)", font: "500 12px var(--font-sans)", cursor: "pointer" }}
              >
                {searching ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
