import { useEffect, useState } from "react";
import { Building2, CircleAlert, RefreshCw, Search, UsersRound } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformMerchant,
} from "../lib/api.js";

const planLabels: Record<PlatformMerchant["plan"], string> = {
  CHECKOUT_ONLY: "Checkout",
  STORE_ONLY: "Loja",
  BOTH: "Loja + checkout",
  API: "API",
};

export function MerchantDirectory({
  api,
  token,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
}) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [items, setItems] = useState<PlatformMerchant[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedMerchant, setSelectedMerchant] = useState<PlatformMerchant | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.listMerchants(token, appliedSearch ? { query: appliedSearch } : {})
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.next_cursor ?? null);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(directoryErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, appliedSearch, onSessionExpired, refreshKey, token]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.listMerchants(token, {
        ...(appliedSearch ? { query: appliedSearch } : {}),
        cursor: nextCursor,
      });
      setItems(current => {
        const known = new Set(current.map(merchant => merchant.id));
        return [...current, ...page.items.filter(merchant => !known.has(merchant.id))];
      });
      setNextCursor(page.next_cursor ?? null);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(directoryErrorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="page-flow merchant-directory">
      <section className="page-intro page-intro--split">
        <div>
          <h2>Diretório de empresas</h2>
          <p>Busque cadastros por nome, identificador ou slug. O plano exibido descreve a configuração operacional e não representa pagamento, vencimento ou inadimplência.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <form className="directory-search" onSubmit={submitSearch} role="search">
        <label className="field" htmlFor="merchant-directory-search">
          <span>Buscar empresa</span>
          <div className="directory-search__control">
            <Search size={17} aria-hidden="true" />
            <input id="merchant-directory-search" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="Nome, ID ou slug" disabled={loading} />
          </div>
        </label>
        <button type="submit" className="button button--primary" disabled={loading}>Buscar</button>
      </form>

      {error ? <DirectoryError message={error} onRetry={() => setRefreshKey(value => value + 1)} /> : null}
      {!error ? (
        <section className="directory-table" aria-label="Empresas cadastradas">
          <div className="directory-table__header" aria-hidden="true">
            <span>Empresa</span><span>Loja</span><span>Plano operacional</span><span>Equipe</span><span>Atualizada</span>
          </div>
          {loading ? <DirectorySkeleton /> : null}
          {!loading && items.length === 0 ? <EmptyDirectory search={appliedSearch} /> : null}
          {!loading && items.map(merchant => <MerchantRow key={merchant.id} merchant={merchant} onOpen={() => setSelectedMerchant(merchant)} />)}
          {!loading && nextCursor ? <button type="button" className="button button--secondary directory-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Carregando..." : "Carregar mais empresas"}</button> : null}
        </section>
      ) : null}
    </div>
  );
}

function MerchantRow({ merchant, onOpen }: { merchant: PlatformMerchant; onOpen: () => void }) {
  return (
    <button type="button" className="directory-row" onClick={onOpen} aria-label={`Abrir detalhes de ${merchant.name}`}>
      <div className="directory-row__merchant">
        <span className="directory-row__mark"><Building2 size={17} aria-hidden="true" /></span>
        <span><strong>{merchant.name}</strong><small title={merchant.id}>{merchant.id}</small></span>
      </div>
      <span className="directory-row__slug">{merchant.store_slug ? `/${merchant.store_slug}` : "Sem slug"}</span>
      <span className="directory-plan">{planLabels[merchant.plan]}</span>
      <span className="directory-members"><UsersRound size={15} aria-hidden="true" />{memberLabel(merchant.member_count)}</span>
      <time className="directory-updated" dateTime={merchant.updated_at}>{formatDate(merchant.updated_at)}</time>
    </button>
  );
}

function DirectorySkeleton() {
  return <div className="directory-skeleton" aria-label="Carregando diretório" aria-busy="true">{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>;
}

function EmptyDirectory({ search }: { search: string }) {
  return <div className="directory-empty"><Building2 size={25} aria-hidden="true" /><h3>{search ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}</h3><p>{search ? "Tente outro nome, identificador ou slug." : "Quando houver cadastros na fonte operacional, eles aparecerão aqui."}</p></div>;
}

function DirectoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="queue-error" role="alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>Não foi possível carregar o diretório</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button></div>;
}

function memberLabel(count: number): string {
  return `${count} ${count === 1 ? "membro" : "membros"}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function directoryErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para acessar o diretório.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de empresas não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}
