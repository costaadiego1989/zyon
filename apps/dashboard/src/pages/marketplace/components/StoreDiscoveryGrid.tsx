import React, { useEffect, useState, useCallback, useRef } from "react";
import { Store, AlertCircle, Copy } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { PageLoader } from "../../../components/PageLoader.js";
import { FilterToolbar, FilterSelect } from "../../../components/FilterToolbar.js";
import { Button } from "../../../components/Button.js";
import { Modal } from "../../../components/Modal.js";
import { copyText } from "../../../utils/clipboard.js";
import type { AvailableStore } from "../../../api/endpoints/marketplace-v2.js";
interface Props {
  apiBaseUrl: string;
}
const DEFAULT_NICHES = [
  "Moda",
  "Eletrônicos",
  "Casa & Decoração",
  "Beleza",
  "Esportes",
  "Alimentos",
  "Pet",
  "Livros",
  "Brinquedos",
  "Saúde",
];
export function StoreDiscoveryGrid(_props: Props) {
  const api = useApi();
  const [stores, setStores] = useState<AvailableStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<AvailableStore | null>(null);
  const readVersion = useRef(0);
  const working = useRef(false);
  const loadStores = useCallback(
    async (cursor?: string) => {
      const version = ++readVersion.current;
      setLoading(!cursor);
      setLoadingMore(!!cursor);
      setError(null);
      setMoreError(null);
      try {
        const result = await api.listAvailableStores({
          category: category || undefined,
          search: search.trim() || undefined,
          limit: 20,
          cursor,
        });
        if (version !== readVersion.current) return;
        setStores((prev) =>
          cursor
            ? [
                ...prev,
                ...result.stores.filter((store) => !prev.some((existing) => existing.id === store.id)),
              ]
            : result.stores
        );
        setNextCursor(result.nextCursor);
      } catch {
        if (version === readVersion.current) {
          if (cursor) setMoreError("Não foi possível carregar mais lojas. Os resultados anteriores foram mantidos.");
          else setError("Não foi possível consultar as lojas. Tente novamente para atualizar os resultados.");
        }
      } finally {
        if (version === readVersion.current) { setLoading(false); setLoadingMore(false); }
      }
    },
    [api, search, category]
  );
  useEffect(() => {
    readVersion.current++;
    setLoading(true);
    const timeout = setTimeout(() => void loadStores(), 250);
    return () => {
      clearTimeout(timeout);
      readVersion.current++;
    };
  }, [loadStores]);
  const changeConnection = async (store: AvailableStore) => {
    if (working.current) return;
    working.current = true;
    setConnecting(true);
    setActionError(null);
    try {
      const result = store.connected ? await api.disconnectStore(store.id) : await api.connectStore(store.id);
      setStores((prev) =>
        prev.map((current) =>
          current.id === store.id ? { ...current, connected: result.connected } : current
        )
      );
      setDisconnecting(null);
      showToast("success", result.connected ? "Loja habilitada" : "Loja desconectada");
    } catch {
      setActionError("Não foi possível alterar a conexão. O estado anterior foi mantido; tente novamente.");
    } finally {
      working.current = false;
      setConnecting(false);
    }
  };
  const clear = () => {
    setSearch("");
    setCategory("");
  };
  return (
    <div className="marketplace-discovery">
      <FilterToolbar
        tabs={[{ key: "all", label: "Lojas disponíveis" }]}
        activeTab="all"
        onTabChange={() => {}}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar lojas por nome"
        extra={
          <FilterSelect
            value={category}
            onChange={setCategory}
            ariaLabel="Categoria da loja"
            options={[
              { value: "", label: "Todas as categorias" },
              ...[...new Set([...DEFAULT_NICHES, ...(category ? [category] : []), ...stores.map((store) => store.category)])]
                .sort()
                .map((value) => ({ value, label: value })),
            ]}
          />
        }
      />
      {actionError && !disconnecting && (
        <p className="marketplace-error" role="alert">
          {actionError}
        </p>
      )}
      {loading ? (
        <PageLoader variant="section" />
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="Lojas indisponíveis"
          description={error}
          action={<Button onClick={() => void loadStores()}>Tentar novamente</Button>}
        />
      ) : !stores.length ? (
        <EmptyState
          icon={Store}
          title={search || category ? "Nenhuma loja com estes filtros" : "Nenhuma loja disponível"}
          description={
            search || category
              ? "Ajuste a busca ou limpe os filtros para encontrar uma parceria."
              : "As lojas disponíveis para parceria aparecerão aqui."
          }
          action={
            search || category ? (
              <Button variant="outline" onClick={clear}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="marketplace-store-list">
            {stores.map((store) => (
              <article key={store.id} className="marketplace-store-row">
                <div className="marketplace-store-avatar">
                  {store.logoUrl ? <img src={store.logoUrl} alt="" /> : <Store size={24} />}
                </div>
                <div className="marketplace-store-content">
                  <h3>{store.name}</h3>
                  <p>
                    {store.category} · {store.commissionPercent}% de comissão
                  </p>
                  {store.description && <p>{store.description}</p>}
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      const ok = await copyText(store.id);
                      showToast(
                        ok ? "success" : "error",
                        ok ? "Código da loja copiado" : "Não foi possível copiar o código. Tente novamente."
                      );
                    }}
                    aria-label={`Copiar código de ${store.name}`}
                  >
                    <Copy size={14} /> Copiar código da loja
                  </Button>
                </div>
                <div className="marketplace-store-actions">
                  <span className={store.connected ? "badge ok" : "badge muted"}>
                    {store.connected ? "Habilitada" : "Não conectada"}
                  </span>
                  <Button
                    variant={store.connected ? "outline" : "primary"}
                    disabled={connecting}
                    onClick={() => {
                      setActionError(null);
                      if (store.connected) setDisconnecting(store);
                      else void changeConnection(store);
                    }}
                  >
                    {store.connected ? "Desconectar" : "Habilitar loja"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {moreError && <p className="marketplace-error" role="alert">{moreError}</p>}
          {nextCursor && (
            <div className="marketplace-more">
              <Button variant="outline" loading={loadingMore} onClick={() => void loadStores(nextCursor)}>
                {moreError ? "Tentar carregar mais lojas" : "Carregar mais lojas"}
              </Button>
            </div>
          )}
        </>
      )}
      <Modal
        isOpen={disconnecting !== null}
        title="Desconectar loja parceira?"
        subtitle={disconnecting?.name}
        presentation="center"
        size="md"
        onClose={() => {
          if (!connecting) {
            setDisconnecting(null);
            setActionError(null);
          }
        }}
        footer={
          <>
            <Button
              variant="outline"
              disabled={connecting}
              onClick={() => {
                setDisconnecting(null);
                setActionError(null);
              }}
            >
              Manter conexão
            </Button>
            <Button
              variant="danger"
              loading={connecting}
              onClick={() => {
                if (disconnecting) void changeConnection(disconnecting);
              }}
            >
              Desconectar
            </Button>
          </>
        }
      >
        <p className="marketplace-help">
          A loja deixará de estar habilitada como parceira. Confira os pedidos existentes na aba Pedidos.
        </p>
        {actionError && (
          <p className="marketplace-error" role="alert">
            {actionError}
          </p>
        )}
      </Modal>
    </div>
  );
}
