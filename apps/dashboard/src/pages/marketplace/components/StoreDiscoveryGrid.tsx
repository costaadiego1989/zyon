import React, { useEffect, useState, useCallback } from "react";
import { Search, Store, Loader2 } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import type { AvailableStore } from "../../../api/endpoints/marketplace-v2.js";
import "./store-discovery.css";

interface StoreDiscoveryGridProps {
  apiBaseUrl: string;
}

interface StoreCategory {
  name: string;
  count: number;
}

export function StoreDiscoveryGrid({ apiBaseUrl }: StoreDiscoveryGridProps) {
  const api = useApi();
  const [stores, setStores] = useState<AvailableStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Load initial stores
  useEffect(() => {
    loadStores();
  }, []);

  // Extract categories from stores
  useEffect(() => {
    const categoryMap = new Map<string, number>();
    stores.forEach((store) => {
      const cat = store.category;
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    });
    const sorted = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setCategories(sorted);
  }, [stores]);

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
      <div className="store-discovery__container">
        <div className="store-discovery__loading">
          <Loader2 size={24} className="animate-spin" />
          <p>Carregando lojas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="store-discovery__container">
      {/* Search Bar */}
      <div className="store-discovery__search-bar">
        <div className="store-discovery__search-input-wrapper">
          <Search size={16} className="store-discovery__search-icon" />
          <input
            type="text"
            placeholder="Buscar lojas por nome..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="store-discovery__search-input"
          />
        </div>
      </div>

      {/* Category Filter */}
      {categories.length > 0 && (
        <div className="store-discovery__filters">
          <button
            className={`store-discovery__filter-chip ${
              selectedCategory === null ? "active" : ""
            }`}
            onClick={() => handleCategoryChange(null)}
          >
            Todas ({stores.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              className={`store-discovery__filter-chip ${
                selectedCategory === cat.name ? "active" : ""
              }`}
              onClick={() => handleCategoryChange(cat.name)}
            >
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
      )}

      {/* Stores Grid */}
      {stores.length === 0 ? (
        <div className="store-discovery__empty">
          <Store size={32} className="store-discovery__empty-icon" />
          <h3>Nenhuma loja disponível</h3>
          <p>
            {searchTerm || selectedCategory
              ? "Tente ajustar seus filtros de busca"
              : "Não há lojas parceiras disponíveis no momento"}
          </p>
        </div>
      ) : (
        <>
          <div className="store-discovery__grid">
            {stores.map((store) => (
              <div key={store.id} className="store-discovery__card">
                {/* Store Logo / Avatar */}
                <div className="store-discovery__logo">
                  {store.logoUrl ? (
                    <img src={store.logoUrl} alt={store.name} />
                  ) : (
                    <div className="store-discovery__logo-placeholder">
                      {store.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Store Info */}
                <div className="store-discovery__info">
                  <h4 className="store-discovery__name">{store.name}</h4>
                  <div className="store-discovery__meta">
                    <span className="store-discovery__category">
                      {store.category}
                    </span>
                    <span className="store-discovery__commission">
                      {store.commissionPercent}% comissão
                    </span>
                  </div>
                </div>

                {/* Connection Status */}
                <div className="store-discovery__status">
                  {store.connected && (
                    <span className="store-discovery__badge--connected">
                      Habilitada
                    </span>
                  )}
                </div>

                {/* Action Button */}
                <button
                  className={`store-discovery__action-btn ${
                    store.connected ? "disconnect" : "connect"
                  }`}
                  onClick={() =>
                    store.connected
                      ? handleDisconnect(store.id)
                      : handleConnect(store.id)
                  }
                  disabled={connecting === store.id}
                >
                  {connecting === store.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : store.connected ? (
                    "Desconectar"
                  ) : (
                    "Habilitar"
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Load More */}
          {nextCursor && (
            <div className="store-discovery__load-more">
              <button
                className="store-discovery__load-more-btn"
                onClick={() => loadStores(nextCursor)}
                disabled={searching}
              >
                {searching ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Carregando...
                  </>
                ) : (
                  "Carregar mais"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
