
import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw, Search, ShieldCheck, UserRoundCog } from "lucide-react";
import {
  PlatformApiError,
  type PlatformOperator,
  type PlatformOperatorAccessAction,
  type PlatformOperatorAccessCommand,
  type PlatformOperatorDirectoryEntry,
  type PlatformOperatorDirectoryPage,
  type PlatformOperatorDirectoryQuery,
  type PlatformOperatorDirectoryStatus,
  type PlatformOperatorRole,
} from "../lib/api.js";
import "./OperatorDirectory.css";

export type OperatorDirectoryStatus = PlatformOperatorDirectoryStatus;
export type OperatorDirectoryEntry = PlatformOperatorDirectoryEntry;
export type OperatorDirectoryPage = PlatformOperatorDirectoryPage;
export type OperatorDirectoryFilters = PlatformOperatorDirectoryQuery;

type OperatorDirectoryProps = {
  operator: PlatformOperator;
  token: string;
  load: (token: string, filters: OperatorDirectoryFilters) => Promise<OperatorDirectoryPage>;
  manage: (token: string, operatorId: string, input: PlatformOperatorAccessCommand) => Promise<OperatorDirectoryEntry>;
  onSessionExpired: () => void;
};

const roleLabels: Record<PlatformOperatorRole, string> = {
  platform_admin: "Administração da plataforma",
  billing_ops: "Operações de cobrança",
  support_ops: "Operações de suporte",
  infra_ops: "Operações de infraestrutura",
  auditor: "Auditoria",
};

const permissionLabels: Record<string, string> = {
  "platform:operators:read": "Operadores",
  "platform:operators:write": "Gerenciar operadores",
  "platform:overview:read": "Visão geral",
  "platform:merchants:read": "Empresas",
  "platform:billing:read": "Cobrança",
  "platform:ai-usage:read": "Uso de IA",
  "platform:feedback:read": "Ler feedback",
  "platform:feedback:write": "Tratar feedback",
  "platform:infrastructure:read": "Infraestrutura",
  "platform:audit:read": "Auditoria",
  "platform:exports:read": "Exportações",
};

export function OperatorDirectory({ operator, token, load, manage, onSessionExpired }: OperatorDirectoryProps) {
  const [page, setPage] = useState<OperatorDirectoryPage | null>(null);
  const [filters, setFilters] = useState<OperatorDirectoryFilters>({});
  const [draft, setDraft] = useState<OperatorDirectoryFilters>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, PlatformOperatorRole>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyCommand, setBusyCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void load(token, { ...filters, limit: 50 })
      .then(result => {
        if (current) setPage(result);
      })
      .catch(caught => {
        if (!current) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(operatorDirectoryError(caught));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [filters, load, onSessionExpired, token, version]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(normalizeFilters(draft));
  }

  function clearFilters() {
    setDraft({});
    setFilters({});
  }

  async function loadMore() {
    if (!page?.next_cursor) return;
    setLoadingMore(true);
    try {
      const next = await load(token, { ...filters, cursor: page.next_cursor, limit: 50 });
      setPage(current => current ? {
        ...next,
        items: [...current.items, ...next.items],
      } : next);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(operatorDirectoryError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  async function runCommand(item: OperatorDirectoryEntry, action: PlatformOperatorAccessAction, role?: PlatformOperatorRole) {
    if (item.operator_id === operator.operator_id) return;
    const input: PlatformOperatorAccessCommand = { action, ...(role ? { role } : {}) };
    if (!window.confirm(commandConfirmation(item, input))) return;

    const key = commandKey(item.operator_id, action);
    setBusyCommand(key);
    setCommandError(null);
    setNotice(null);
    try {
      const updated = await manage(token, item.operator_id, input);
      setPage(current => current ? {
        ...current,
        items: current.items.map(candidate => candidate.operator_id === updated.operator_id ? updated : candidate),
      } : current);
      setRoleDrafts(current => ({ ...current, [updated.operator_id]: updated.role }));
      setNotice(commandSuccessMessage(updated, action));
      setVersion(value => value + 1);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setCommandError(operatorCommandError(caught));
    } finally {
      setBusyCommand(null);
    }
  }

  return (
    <div className="page-flow operator-directory">
      <section className="page-intro page-intro--split">
        <div>
          <p className="eyebrow">Acesso interno</p>
          <h2>Operadores da plataforma</h2>
          <p>Identidades internas, papéis e permissões efetivas. Senhas, versões de autenticação e sessões não aparecem nesta leitura.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setVersion(value => value + 1)} disabled={loading || busyCommand !== null}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <section className="operator-directory__disclosure" aria-label="Escopo da gestão de operadores">
        <span><ShieldCheck size={18} aria-hidden="true" /></span>
        <p>Administradores podem alterar o papel, desativar, reativar ou encerrar sessões de outra identidade. Cada ação exige confirmação, invalida as sessões do alvo e cria uma trilha de auditoria.</p>
      </section>

      <form className="operator-directory__toolbar" aria-label="Filtros do diretório de operadores" onSubmit={applyFilters}>
        <Search size={17} aria-hidden="true" />
        <label className="field operator-directory__search">
          <span>E-mail</span>
          <input type="search" value={draft.query ?? ""} onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Buscar operador" autoComplete="off" maxLength={120} disabled={loading || busyCommand !== null} />
        </label>
        <label className="field">
          <span>Papel</span>
          <select value={draft.role ?? ""} onChange={event => setDraft(current => ({ ...current, role: event.target.value as PlatformOperatorRole || undefined }))} disabled={loading || busyCommand !== null}>
            <option value="">Todos</option>
            {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={draft.status ?? ""} onChange={event => setDraft(current => ({ ...current, status: event.target.value as OperatorDirectoryStatus || undefined }))} disabled={loading || busyCommand !== null}>
            <option value="">Todos</option><option value="active">Ativo</option><option value="disabled">Desativado</option>
          </select>
        </label>
        <div className="operator-directory__actions">
          <button type="submit" className="button button--primary" disabled={loading || busyCommand !== null}>Aplicar</button>
          <button type="button" className="button button--secondary" onClick={clearFilters} disabled={loading || busyCommand !== null || !hasFilters(draft)}>Limpar</button>
        </div>
      </form>

      {notice ? <p className="operator-directory__notice" role="status">{notice}</p> : null}
      {commandError ? <OperatorDirectoryFailure title="Comando não concluído" message={commandError} onRetry={() => setVersion(value => value + 1)} /> : null}
      {loading && !page ? <OperatorDirectoryLoading /> : null}
      {error && !page ? <OperatorDirectoryFailure title="Não foi possível carregar os operadores" message={error} onRetry={() => setVersion(value => value + 1)} /> : null}
      {page ? <>
        <section className="operator-directory__facts" aria-label="Resumo de operadores">
          <OperatorFact label="Operadores provisionados" value={formatNumber(page.summary.total)} detail="Papéis reconhecidos pela Central" />
          <OperatorFact label="Acessos ativos" value={formatNumber(page.summary.active)} detail="Identidades sem desativação" />
          <OperatorFact label="Acessos desativados" value={formatNumber(page.summary.disabled)} detail="Mantidos para rastreabilidade" />
        </section>
        {error ? <OperatorDirectoryFailure title="Atualização do diretório falhou" message={error} onRetry={() => setVersion(value => value + 1)} /> : null}
        <section className="operator-directory__records" aria-label="Operadores encontrados">
          <div className="section-heading">
            <div><p className="eyebrow">Diretório interno</p><h2>Identidades, permissões e acesso</h2></div>
            <span className="quiet-note">Atualizado em {formatDateTime(page.generated_at)}</span>
          </div>
          {page.items.length === 0 ? <OperatorDirectoryEmpty hasFilters={hasFilters(filters)} /> : <OperatorDirectoryTable
            items={page.items}
            currentOperatorId={operator.operator_id}
            roleDrafts={roleDrafts}
            busyCommand={busyCommand}
            onRoleChange={(operatorId, role) => setRoleDrafts(current => ({ ...current, [operatorId]: role }))}
            onCommand={runCommand}
          />}
          {page.next_cursor ? <button type="button" className="button button--secondary operator-directory__more" onClick={() => void loadMore()} disabled={loadingMore || busyCommand !== null}>{loadingMore ? "Carregando..." : "Carregar mais operadores"}</button> : null}
        </section>
      </> : null}
    </div>
  );
}

function OperatorDirectoryTable({
  items,
  currentOperatorId,
  roleDrafts,
  busyCommand,
  onRoleChange,
  onCommand,
}: {
  items: OperatorDirectoryEntry[];
  currentOperatorId: string;
  roleDrafts: Record<string, PlatformOperatorRole>;
  busyCommand: string | null;
  onRoleChange: (operatorId: string, role: PlatformOperatorRole) => void;
  onCommand: (item: OperatorDirectoryEntry, action: PlatformOperatorAccessAction, role?: PlatformOperatorRole) => Promise<void>;
}) {
  return <div className="operator-directory__table-wrap"><table className="operator-directory__table">
    <caption className="visually-hidden">Operadores internos, permissões efetivas e ações administrativas.</caption>
    <thead><tr><th scope="col">Operador</th><th scope="col">Papel</th><th scope="col">Permissões</th><th scope="col">Estado</th><th scope="col">Atualizado</th><th scope="col">Ações</th></tr></thead>
    <tbody>{items.map(item => {
      const selectedRole = roleDrafts[item.operator_id] ?? item.role;
      const isSelf = item.operator_id === currentOperatorId;
      const isBusy = busyCommand?.startsWith(item.operator_id + ":") ?? false;
      return <tr key={item.operator_id}>
        <th scope="row"><strong>{item.email}</strong><small>{item.operator_id}</small></th>
        <td>{roleLabels[item.role]}</td>
        <td><div className="operator-directory__permissions">{item.permissions.map(permission => <span key={permission}>{permissionLabels[permission] ?? permission}</span>)}</div></td>
        <td><span className={"operator-directory__status operator-directory__status--" + item.status}><i aria-hidden="true" />{item.status === "active" ? "Ativo" : "Desativado"}</span></td>
        <td><time dateTime={item.updated_at}>{formatDateTime(item.updated_at)}</time></td>
        <td>{isSelf ? <span className="operator-directory__self-note">Seu próprio acesso não pode ser alterado aqui.</span> : <div className="operator-directory__management">
          <label><span className="visually-hidden">Novo papel para {item.email}</span><select value={selectedRole} onChange={event => onRoleChange(item.operator_id, event.target.value as PlatformOperatorRole)} disabled={isBusy}><option value="platform_admin">Administração da plataforma</option><option value="billing_ops">Operações de cobrança</option><option value="support_ops">Operações de suporte</option><option value="infra_ops">Operações de infraestrutura</option><option value="auditor">Auditoria</option></select></label>
          <button type="button" className="button button--secondary" onClick={() => void onCommand(item, "change_role", selectedRole)} disabled={isBusy || selectedRole === item.role}>{isBusy ? "Aguarde..." : "Salvar papel"}</button>
          {item.status === "active" ? <><button type="button" className="button button--secondary" onClick={() => void onCommand(item, "revoke_sessions")} disabled={isBusy}>Encerrar sessões</button><button type="button" className="button button--secondary operator-directory__danger" onClick={() => void onCommand(item, "disable")} disabled={isBusy}>Desativar</button></> : <button type="button" className="button button--secondary" onClick={() => void onCommand(item, "enable")} disabled={isBusy}>{isBusy ? "Aguarde..." : "Reativar"}</button>}
        </div>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function OperatorFact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <dl><div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div></dl>;
}

function OperatorDirectoryLoading() {
  return <section className="operator-directory__loading" aria-live="polite" aria-busy="true"><UserRoundCog size={24} aria-hidden="true" /><h3>Carregando operadores</h3><p>Consultando as identidades internas provisionadas.</p></section>;
}

function OperatorDirectoryFailure({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <section className="queue-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><div><strong>{title}</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Atualizar</button></section>;
}

function OperatorDirectoryEmpty({ hasFilters: filtered }: { hasFilters: boolean }) {
  return <div className="operator-directory__empty"><UserRoundCog size={24} aria-hidden="true" /><h3>{filtered ? "Nenhum operador corresponde aos filtros" : "Nenhum operador provisionado"}</h3><p>{filtered ? "Ajuste os filtros para ampliar a consulta." : "O primeiro operador aparece aqui depois do provisionamento seguro."}</p></div>;
}

function normalizeFilters(filters: OperatorDirectoryFilters): OperatorDirectoryFilters {
  return {
    ...(filters.query?.trim() ? { query: filters.query.trim() } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

function hasFilters(filters: OperatorDirectoryFilters): boolean {
  return Boolean(filters.query?.trim() || filters.role || filters.status);
}

function commandKey(operatorId: string, action: PlatformOperatorAccessAction): string {
  return operatorId + ":" + action;
}

function commandConfirmation(item: OperatorDirectoryEntry, input: PlatformOperatorAccessCommand): string {
  if (input.action === "change_role") return "Alterar o papel de " + item.email + " para " + roleLabels[input.role!] + "? Todas as sessões desse operador serão encerradas imediatamente.";
  if (input.action === "disable") return "Desativar " + item.email + "? A identidade deixará de acessar a Central e todas as sessões serão encerradas.";
  if (input.action === "enable") return "Reativar " + item.email + "? Sessões anteriores continuam encerradas e o operador precisará entrar novamente.";
  return "Encerrar todas as sessões ativas de " + item.email + "? O operador precisará entrar novamente.";
}

function commandSuccessMessage(item: OperatorDirectoryEntry, action: PlatformOperatorAccessAction): string {
  if (action === "change_role") return "Papel de " + item.email + " atualizado. As sessões anteriores foram encerradas.";
  if (action === "disable") return item.email + " foi desativado e suas sessões foram encerradas.";
  if (action === "enable") return item.email + " foi reativado. Um novo login será necessário.";
  return "As sessões de " + item.email + " foram encerradas.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function operatorDirectoryError(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não possui permissão para consultar os operadores.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de operadores não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}

function operatorCommandError(error: unknown): string {
  if (error instanceof PlatformApiError && error.code === "platform_operator_last_admin_protected") return "A Central protegeu o último administrador ativo da plataforma.";
  if (error instanceof PlatformApiError && error.code === "platform_operator_self_management_forbidden") return "Seu próprio acesso não pode ser alterado por esta tela.";
  if (error instanceof PlatformApiError && error.code === "platform_operator_no_change") return "Esse comando não altera o estado atual do operador.";
  if (error instanceof PlatformApiError && error.status === 403) return "Seu acesso administrativo não está mais autorizado para este comando.";
  if (error instanceof PlatformApiError && error.status === 404) return "O operador não está mais disponível. Atualize o diretório.";
  return "Não foi possível concluir o comando. Nenhuma confirmação de alteração foi exibida; atualize o diretório antes de tentar novamente.";
}
