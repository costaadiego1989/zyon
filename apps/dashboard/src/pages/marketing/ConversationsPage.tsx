import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import {
  marketingApi,
  type MarketingConversation,
  type MarketingConversationDetail,
  type MarketingMessage,
  type MarketingPage,
} from "../../api/marketing.js";
import { PageHeader } from "../../components/PageHeader.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Pagination } from "../../components/Pagination.js";
import { PageLoader } from "../../components/PageLoader.js";
import {
  marketingError,
  originLabel,
  contactName,
  marketingDate,
} from "./marketing-format.js";
import "./marketing.css";

function mergeMessages(
  current: MarketingMessage[],
  incoming: MarketingMessage[]
) {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (BigInt(a.sequence ?? "0") < BigInt(b.sequence ?? "0") ? -1 : 1)
  );
}
const messageStatus: Record<MarketingMessage["status"], string> = {
  queued: "Na fila",
  sending: "Verificando envio",
  accepted: "Aceita pelo provedor",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha no envio",
  suppressed: "Não enviada",
  unknown: "Resultado incerto",
  recorded: "Registro histórico",
};

export function ConversationsPage({
  apiBaseUrl,
  me,
  initialConversationId,
  onContact,
  onMarketing,
}: {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  initialConversationId?: string;
  onContact?: (id: string) => void;
  onMarketing?: () => void;
}) {
  const api = useMemo(() => marketingApi(apiBaseUrl), [apiBaseUrl]);
  const [filters, setFilters] = useState({
    channel: "",
    mode: "",
    assignment: "",
    search: "",
    offset: 0,
  });
  const [page, setPage] = useState<MarketingPage<MarketingConversation>>({
    items: [],
    total: 0,
  });
  const [selected, setSelected] = useState<string | null>(
    initialConversationId ?? null
  );
  const [detail, setDetail] = useState<MarketingConversationDetail | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const currentId = useRef(selected);
  currentId.current = selected;
  const request = useRef<{ text: string; id: string } | null>(null);
  useEffect(() => {
    if (initialConversationId) setSelected(initialConversationId);
  }, [initialConversationId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        void api
          .conversations({ ...filters, limit: 25 })
          .then((value) => {
            if (active) setPage(value);
          })
          .catch((error) => {
            if (active) setError(marketingError(error));
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      filters.search ? 250 : 0
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, filters, revision]);
  useEffect(() => {
    setDetail(null);
    setText("");
    setError("");
    setNotice("");
    request.current = null;
    if (!selected) return;
    let active = true,
      pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const value = await api.conversation(selected);
        if (active)
          setDetail((previous) => {
            if (
              previous?.conversation.id === selected &&
              previous.conversation.version > value.conversation.version
            )
              return previous;
            return {
              ...value,
              messages:
                previous?.conversation.id === selected
                  ? mergeMessages(previous.messages, value.messages)
                  : value.messages,
              before:
                previous?.conversation.id === selected &&
                previous.messages.length > 50
                  ? previous.before
                  : value.before,
              hasMore:
                previous?.conversation.id === selected &&
                previous.messages.length > 50
                  ? previous.hasMore
                  : value.hasMore,
            };
          });
      } catch (error) {
        if (active) setError(marketingError(error));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, selected]);
  const filter = (
    key: "channel" | "mode" | "assignment" | "search",
    value: string
  ) => setFilters((previous) => ({ ...previous, [key]: value, offset: 0 }));
  const ownership = async (action: "claim" | "release") => {
    if (!detail) return;
    const id = detail.conversation.id;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const conversation = await api.ownership(
        id,
        action,
        detail.conversation.version
      );
      if (currentId.current === id)
        setDetail((previous) =>
          previous ? { ...previous, conversation } : previous
        );
      setRevision((value) => value + 1);
    } catch (error) {
      if (currentId.current === id) setError(marketingError(error));
    } finally {
      setBusy(false);
    }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !text.trim()) return;
    const id = detail.conversation.id;
    const content = text.trim();
    setBusy(true);
    setError("");
    setNotice("");
    if (request.current?.text !== content)
      request.current = { text: content, id: crypto.randomUUID() };
    try {
      const result = await api.reply(
        id,
        content,
        request.current.id,
        detail.conversation.version
      );
      if (currentId.current === id) {
        setDetail((previous) =>
          previous
            ? {
                ...previous,
                conversation: result.conversation,
                messages: mergeMessages(previous.messages, [result.message]),
              }
            : previous
        );
        setText("");
        request.current = null;
        setNotice(
          result.message.status === "unknown"
            ? "O resultado do envio é incerto. A mensagem não será repetida automaticamente."
            : result.message.status === "accepted"
            ? detail.conversation.channel === "site"
              ? "Resposta publicada no site."
              : "Mensagem aceita pelo provedor. Aguardando confirmação de entrega."
            : "A mensagem não foi enviada. Confira a situação no histórico."
        );
      }
      setRevision((value) => value + 1);
    } catch (error) {
      if (currentId.current === id) setError(marketingError(error));
    } finally {
      setBusy(false);
    }
  };
  const loadOlder = async () => {
    if (!detail?.before) return;
    const id = detail.conversation.id;
    setOlder(true);
    try {
      const value = await api.conversation(id, detail.before);
      if (currentId.current === id)
        setDetail((previous) =>
          previous
            ? {
                ...previous,
                messages: mergeMessages(value.messages, previous.messages),
                before: value.before,
                hasMore: value.hasMore,
              }
            : previous
        );
    } catch (error) {
      if (currentId.current === id) setError(marketingError(error));
    } finally {
      setOlder(false);
    }
  };
  const conversation = detail?.conversation;
  const own =
    conversation?.mode === "human" &&
    conversation.assignedUserId === me?.user_id;
  const expired =
    conversation?.channel === "whatsapp" &&
    Date.now() - Date.parse(conversation.lastInboundAt) >= 86400000;
  return (
    <div className="page-container marketing-page">
      <PageHeader
        title="Conversas"
        description="Atenda pelo site e WhatsApp e acompanhe o trabalho da IA."
      />
      <FilterToolbar
        tabs={[
          { key: "", label: "Todos os canais" },
          { key: "whatsapp", label: "WhatsApp" },
          { key: "site", label: "Site" },
        ]}
        activeTab={filters.channel}
        onTabChange={(value) => filter("channel", value)}
        search={filters.search}
        onSearchChange={(value) => filter("search", value)}
        searchPlaceholder="Nome ou telefone"
        extra={
          <>
            <FilterSelect
              value={filters.mode}
              onChange={(value) => filter("mode", value)}
              placeholder="IA e equipe"
              options={[
                { value: "ai", label: "Com a IA" },
                { value: "human", label: "Com a equipe" },
              ]}
            />
            <FilterSelect
              value={filters.assignment}
              onChange={(value) => filter("assignment", value)}
              placeholder="Todos os responsáveis"
              options={[
                { value: "mine", label: "Meus atendimentos" },
                { value: "unassigned", label: "Sem agente humano" },
              ]}
            />
          </>
        }
      />
      {error && (
        <div role="alert" className="marketing-notice">
          {error}
          <Button
            variant="outline"
            onClick={() => {
              setRevision((value) => value + 1);
              if (selected) {
                const id = selected;
                void api
                  .conversation(id)
                  .then((value) => {
                    if (currentId.current === id) {
                      setDetail(value);
                      setError("");
                    }
                  })
                  .catch((error) => setError(marketingError(error)));
              }
            }}
          >
            Atualizar dados
          </Button>
        </div>
      )}
      <div
        className="marketing-inbox"
        data-selected={selected ? "true" : "false"}
      >
        <aside className="marketing-threads" aria-label="Lista de conversas">
          {loading ? (
            <PageLoader variant="section" />
          ) : page.items.length ? (
            <>
              <p className="marketing-thread-count">
                {page.total.toLocaleString("pt-BR")} conversas
              </p>
              {page.items.map((item) => (
                <button
                  type="button"
                  className="marketing-thread"
                  key={item.id}
                  aria-pressed={selected === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>
                    {item.contactName ||
                      (item.phoneTail
                        ? `Contato • ${item.phoneTail}`
                        : item.contactId
                        ? "Contato do site"
                        : "Sessão anônima do site")}
                  </strong>
                  <span>
                    {originLabel(item.channel)} ·{" "}
                    {item.channel === "unknown"
                      ? "Somente leitura"
                      : item.mode === "ai"
                      ? "IA"
                      : item.assignedUserId === me?.user_id
                      ? "Seu atendimento"
                      : "Outro agente"}
                  </span>
                  <small>{marketingDate(item.updatedAt)}</small>
                </button>
              ))}
              <Pagination
                page={filters.offset / 25 + 1}
                pageSize={25}
                total={page.total}
                onChange={(value) =>
                  setFilters((previous) => ({
                    ...previous,
                    offset: (value - 1) * 25,
                  }))
                }
              />
            </>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma conversa neste filtro"
              description="Novos atendimentos do site e WhatsApp aparecerão aqui."
            />
          )}
        </aside>
        <section
          className="marketing-thread-detail"
          aria-label="Conversa selecionada"
        >
          {selected ? (
            <>
              <Button
                variant="ghost"
                className="marketing-back"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Voltar à lista
              </Button>
              {!detail ? (
                !error && <PageLoader variant="section" />
              ) : (
                <>
                  <header className="marketing-thread-header">
                    <div>
                      <h2>
                        {detail.contact
                          ? contactName(detail.contact)
                          : "Sessão anônima do site"}
                      </h2>
                      <p>
                        {originLabel(detail.conversation.channel)} ·{" "}
                        {detail.conversation.channel === "unknown"
                          ? "Histórico anterior (somente leitura)"
                          : detail.conversation.mode === "ai"
                          ? "IA ativa"
                          : own
                          ? "Atendimento com você"
                          : "Atendimento com outro agente"}
                      </p>
                    </div>
                    <div className="marketing-actions">
                      {detail.contact && onContact && (
                        <Button
                          variant="outline"
                          onClick={() => onContact(detail.contact!.id)}
                        >
                          Ver contato
                        </Button>
                      )}
                      {detail.conversation.mode === "ai" ? (
                        <Button
                          loading={busy}
                          disabled={detail.conversation.channel === "unknown"}
                          onClick={() => void ownership("claim")}
                        >
                          Assumir conversa
                        </Button>
                      ) : (
                        <Button
                          loading={busy}
                          disabled={!own}
                          onClick={() => void ownership("release")}
                        >
                          Finalizar atendimento
                        </Button>
                      )}
                    </div>
                  </header>
                  {detail.hasMore && (
                    <Button
                      variant="ghost"
                      loading={older}
                      onClick={() => void loadOlder()}
                    >
                      Carregar mensagens anteriores
                    </Button>
                  )}
                  <ol
                    className="marketing-messages"
                    role="log"
                    aria-label="Mensagens da conversa"
                    aria-live="polite"
                  >
                    {detail.messages.map((message) => (
                      <li key={message.id} data-role={message.role}>
                        <div>
                          <small>
                            {message.role === "buyer"
                              ? "Cliente"
                              : message.role === "agent"
                              ? "Equipe"
                              : message.role === "ai"
                              ? "IA"
                              : "Sistema"}{" "}
                            · {marketingDate(message.createdAt)}
                          </small>
                          <p>{message.content}</p>
                          {message.role !== "buyer" &&
                            message.role !== "system" && (
                              <small>
                                {detail.conversation.channel === "site" &&
                                message.status === "accepted"
                                  ? "Publicada no site"
                                  : messageStatus[message.status]}
                              </small>
                            )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {expired && (
                    <div className="marketing-notice">
                      <p>
                        A janela de 24 horas do WhatsApp terminou. Aguarde uma
                        nova mensagem do cliente ou use uma campanha com
                        template aprovado e autorização.
                      </p>
                      {onMarketing && (
                        <Button variant="outline" onClick={onMarketing}>
                          Abrir campanhas
                        </Button>
                      )}
                    </div>
                  )}
                  {notice && (
                    <p role="status" className="marketing-notice">
                      {notice}
                    </p>
                  )}
                  <form
                    className="marketing-reply marketing-form"
                    onSubmit={send}
                  >
                    <label>
                      Responder ao cliente
                      <textarea
                        value={text}
                        maxLength={4000}
                        required
                        disabled={!own || expired || busy}
                        onChange={(event) => setText(event.target.value)}
                        placeholder={
                          own
                            ? "Escreva sua resposta"
                            : "Assuma a conversa para responder"
                        }
                      />
                    </label>
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={!own || expired || !text.trim()}
                    >
                      Enviar resposta
                    </Button>
                    {own && (
                      <p className="marketing-help">
                        A IA fica pausada até você finalizar o atendimento.
                      </p>
                    )}
                  </form>
                </>
              )}
            </>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Selecione uma conversa"
              description="Leia o histórico, assuma o atendimento e responda no canal do cliente."
            />
          )}
        </section>
      </div>
    </div>
  );
}
