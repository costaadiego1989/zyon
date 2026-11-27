import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  MessageSquare,
  X,
} from "lucide-react";
import {
  marketingApi,
  marketingStages,
  marketingStageLabels,
  type MarketingContactDetail,
  type MarketingFunnel,
  type MarketingPage,
  type MarketingContact,
  type MarketingStage,
} from "../../api/marketing.js";
import { Button } from "../../components/Button.js";
import { Pagination } from "../../components/Pagination.js";
import { SearchInput } from "../../components/SearchInput.js";
import { MarketingEmptyState } from "./MarketingEmptyState.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import {
  contactName,
  originLabel,
  marketingDate,
  marketingMoney,
  marketingError,
} from "./marketing-format.js";
import "./marketing.css";

export function ContactsPanel({
  apiBaseUrl,
  onConversation,
  initialContactId,
}: {
  apiBaseUrl: string;
  onConversation?: (id: string) => void;
  initialContactId?: string;
}) {
  const api = useMemo(() => marketingApi(apiBaseUrl), [apiBaseUrl]);
  const [query, setQuery] = useState({
    search: "",
    channel: "",
    stage: "",
    buyer: "",
    offset: 0,
  });
  const [page, setPage] = useState<MarketingPage<MarketingContact>>({
    items: [],
    total: 0,
  });
  const [funnel, setFunnel] = useState<MarketingFunnel | null>(null);
  const [selected, setSelected] = useState<string | null>(
    initialContactId ?? null
  );
  useEffect(() => {
    if (initialContactId) setSelected(initialContactId);
  }, [initialContactId]);
  const [detail, setDetail] = useState<MarketingContactDetail | null>(null);
  const [stage, setStage] = useState<MarketingStage>("new");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  const hasFilters = Boolean(
    query.search || query.channel || query.stage || query.buyer
  );
  const clearFilters = () =>
    setQuery({ search: "", channel: "", stage: "", buyer: "", offset: 0 });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        void Promise.all([api.contacts({ ...query, limit: 25 }), api.funnel()])
          .then(([page, funnel]) => {
            if (active) {
              setPage(page);
              setFunnel(funnel);
            }
          })
          .catch((error) => {
            if (active) setError(marketingError(error));
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      query.search ? 250 : 0
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, query, revision]);
  useEffect(() => {
    setDetail(null);
    setReason("");
    if (!selected) return;
    let active = true;
    void api
      .contact(selected)
      .then((value) => {
        if (active) {
          setDetail(value);
          setStage(value.contact.stage);
        }
      })
      .catch((error) => {
        if (active) setError(marketingError(error));
      });
    return () => {
      active = false;
    };
  }, [api, selected, revision]);
  const filter = (
    key: "search" | "channel" | "stage" | "buyer",
    value: string
  ) => setQuery((previous) => ({ ...previous, [key]: value, offset: 0 }));
  const move = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !reason.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api.move(
        detail.contact.id,
        stage,
        reason.trim(),
        detail.contact.version
      );
      refresh();
    } catch (error) {
      setError(marketingError(error));
    } finally {
      setSaving(false);
    }
  };
  const revoke = async () => {
    if (!detail) return;
    setSaving(true);
    setError("");
    try {
      await api.optOut(detail.contact.id);
      refresh();
    } catch (error) {
      setError(marketingError(error));
    } finally {
      setSaving(false);
    }
  };
  if (selected)
    return (
      <section className="marketing-contact-detail">
        <Button variant="ghost" onClick={() => setSelected(null)}>
          <ArrowLeft size={16} aria-hidden="true" /> Voltar aos contatos
        </Button>
        {error && (
          <p role="alert" className="marketing-notice">
            {error}{" "}
            <Button variant="outline" onClick={refresh}>
              Atualizar
            </Button>
          </p>
        )}
        {!detail ? (
          error ? null : (
            <p role="status">Carregando contato…</p>
          )
        ) : (
          <>
            <header>
              <h2>{contactName(detail.contact)}</h2>
              <p>
                {detail.contact.purchaseCount ? "Comprador" : "Lead"} · Origem:{" "}
                {originLabel(detail.contact.origin)} ·{" "}
                {detail.contact.channels.map(originLabel).join(" e ")}
              </p>
            </header>
            <dl className="marketing-facts">
              <div>
                <dt>Telefone</dt>
                <dd>{detail.contact.phone || "Ainda não identificado"}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{detail.contact.email || "Não informado"}</dd>
              </div>
              <div>
                <dt>Etapa atual</dt>
                <dd>{marketingStageLabels[detail.contact.stage]}</dd>
              </div>
              <div>
                <dt>Tempo nesta etapa</dt>
                <dd>
                  {Math.floor(detail.timeInStageMs / 3600000).toLocaleString(
                    "pt-BR"
                  )}{" "}
                  horas
                </dd>
              </div>
              <div>
                <dt>Compras confirmadas</dt>
                <dd>{detail.contact.purchaseCount}</dd>
              </div>
              <div>
                <dt>Valor comprado na loja</dt>
                <dd>{marketingMoney(detail.contact.totalSpentCents)}</dd>
              </div>
              <div>
                <dt>Conversas conhecidas</dt>
                <dd>{detail.activity.conversationCount}</dd>
              </div>
              <div>
                <dt>Mensagens conhecidas</dt>
                <dd>{detail.activity.messageCount}</dd>
              </div>
            </dl>
            <section className="marketing-section">
              <h3>Promoções pelo WhatsApp</h3>
              <p>
                {detail.consent?.status === "granted"
                  ? "Recebimento autorizado"
                  : detail.consent
                  ? "Recebimento não autorizado"
                  : "Sem autorização comprovada"}
                {detail.consent
                  ? ` · Registrado em ${marketingDate(
                      detail.consent.recordedAt
                    )}`
                  : ""}
              </p>
              {detail.consent?.status === "granted" && (
                <Button variant="outline" loading={saving} onClick={revoke}>
                  Registrar pedido de descadastro
                </Button>
              )}
            </section>
            <form className="marketing-section marketing-form" onSubmit={move}>
              <h3>Atualizar etapa</h3>
              <label>
                Nova etapa
                <select
                  value={stage}
                  onChange={(event) =>
                    setStage(event.target.value as MarketingStage)
                  }
                >
                  {marketingStages.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={value === "purchased"}
                    >
                      {marketingStageLabels[value]}
                      {value === "purchased" ? " (confirmada por compra)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Motivo
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Registre o que mudou no atendimento"
                />
              </label>
              <Button
                type="submit"
                loading={saving}
                disabled={
                  !reason.trim() ||
                  stage === detail.contact.stage ||
                  stage === "purchased"
                }
              >
                Salvar etapa
              </Button>
            </form>
            <section className="marketing-section">
              <h3>Histórico do funil</h3>
              {detail.history.length ? (
                <ol className="marketing-timeline">
                  {detail.history.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {marketingStageLabels[item.from]} →{" "}
                        {marketingStageLabels[item.to]}
                      </strong>
                      <p>{item.reason}</p>
                      <small>
                        {item.author === "ai"
                          ? "IA"
                          : item.author === "business"
                          ? "Evento confirmado do sistema"
                          : "Equipe"}{" "}
                        · {marketingDate(item.occurredAt)}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>O contato ainda não mudou de etapa.</p>
              )}
            </section>
            <section className="marketing-section">
              <h3>Conversas recentes</h3>
              {detail.activity.conversations.map((conversation) => (
                <div className="marketing-list-row" key={conversation.id}>
                  <span>
                    {originLabel(conversation.channel)} ·{" "}
                    {marketingDate(conversation.updatedAt)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={!onConversation}
                    onClick={() => onConversation?.(conversation.id)}
                  >
                    Abrir conversa
                  </Button>
                </div>
              ))}
            </section>
          </>
        )}
      </section>
    );
  return (
    <section className="marketing-contacts">
      {error && (
        <p role="alert" className="marketing-notice">
          {error}{" "}
          <Button variant="outline" onClick={refresh}>
            Tentar novamente
          </Button>
        </p>
      )}
      <section
        className="marketing-section marketing-funnel"
        aria-label="Funil de contatos identificados"
      >
        <header className="marketing-section-heading">
          <div>
            <h2>Funil de relacionamento</h2>
            <p>Acompanhe a etapa atual dos contatos da sua loja.</p>
          </div>
          <span className="marketing-total">
            {funnel?.total.toLocaleString("pt-BR") ?? "—"} contatos
            identificados
          </span>
        </header>
        <div className="marketing-stages">
          {marketingStages.map((stage) => {
            const total =
              funnel?.rows
                .filter((row) => row.stage === stage)
                .reduce((sum, row) => sum + row.total, 0) ?? 0;
            return (
              <button
                type="button"
                key={stage}
                className="marketing-stage"
                aria-pressed={query.stage === stage}
                onClick={() =>
                  filter("stage", query.stage === stage ? "" : stage)
                }
              >
                <span className="marketing-stage__label">
                  {marketingStageLabels[stage]}
                </span>
                <strong>{funnel ? total.toLocaleString("pt-BR") : "—"}</strong>
                <span className="marketing-funnel-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${
                        funnel?.total ? (total / funnel.total) * 100 : 0
                      }%`,
                    }}
                  />
                </span>
                <small>
                  {funnel?.rows
                    .filter((row) => row.stage === stage)
                    .map((row) => `${originLabel(row.origin)}: ${row.total}`)
                    .join(" · ") || "Nenhum contato"}
                </small>
              </button>
            );
          })}
        </div>
      </section>
      <section className="marketing-contact-list" aria-label="Contatos da loja">
        <header className="marketing-section-heading">
          <div className="marketing-list-title">
            <h2>Contatos da loja</h2>
            <span className="marketing-count">
              {page.total.toLocaleString("pt-BR")}
            </span>
          </div>
        </header>
        <div className="marketing-contact-filters">
          <SearchInput
            value={query.search}
            onChange={(value) => filter("search", value)}
            placeholder="Nome, telefone ou e-mail"
            width="100%"
          />
          <FilterToolbar
            tabs={[
              { key: "", label: "Todos os canais" },
              { key: "whatsapp", label: "WhatsApp" },
              { key: "site", label: "Site" },
            ]}
            activeTab={query.channel}
            onTabChange={(value) => filter("channel", value)}
            extra={
              <FilterSelect
                value={query.buyer}
                onChange={(value) => filter("buyer", value)}
                placeholder="Leads e compradores"
                options={[
                  { value: "lead", label: "Leads" },
                  { value: "customer", label: "Compradores" },
                ]}
              />
            }
          />
        </div>
        {query.stage && (
          <p className="marketing-active-filter">
            <span>
              Etapa:{" "}
              <strong>
                {marketingStageLabels[query.stage as MarketingStage]}
              </strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => filter("stage", "")}
            >
              <X size={14} aria-hidden="true" /> Limpar etapa
            </Button>
          </p>
        )}
        {loading ? (
          <div role="status" className="marketing-loading">
            <span>Carregando contatos…</span>
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="marketing-skeleton"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : !page.items.length ? (
          <MarketingEmptyState
            icon={Users}
            title="Nenhum contato neste filtro"
            description={
              hasFilters
                ? "Tente outra busca ou remova os filtros para ver todos os contatos."
                : "Os contatos do WhatsApp aparecem no primeiro atendimento. No site, após cadastro ou login."
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : (
                <a href="#conversations" className="marketing-empty-link">
                  <MessageSquare size={16} aria-hidden="true" /> Abrir conversas{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              )
            }
          />
        ) : (
          <>
            <div className="marketing-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Contato</th>
                    <th className="marketing-column-origin">Origem</th>
                    <th>Etapa</th>
                    <th className="marketing-column-purchases">Compras</th>
                    <th className="marketing-column-date">Último contato</th>
                    <th>
                      <span className="sr-only">Detalhes</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((contact) => (
                    <tr key={contact.id}>
                      <td className="marketing-contact-cell">
                        <div className="marketing-contact-identity">
                          <span className="marketing-avatar" aria-hidden="true">
                            {contact.name ? (
                              contact.name
                                .trim()
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) => part[0])
                                .join("")
                                .toUpperCase()
                            ) : (
                              <Users size={17} />
                            )}
                          </span>
                          <div>
                            <strong>{contactName(contact)}</strong>
                            <small>
                              {contact.phone
                                ? `Telefone terminado em ${contact.phone.slice(
                                    -4
                                  )}`
                                : contact.email || "Telefone não identificado"}
                            </small>
                            <small className="marketing-mobile-origin">
                              {originLabel(contact.origin)}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="marketing-column-origin">
                        <span
                          className="marketing-origin"
                          data-channel={contact.origin}
                        >
                          {originLabel(contact.origin)}
                        </span>
                        <small>
                          {contact.channels.length > 1 ? "Site e WhatsApp" : ""}
                        </small>
                      </td>
                      <td>
                        <span
                          className="marketing-stage-badge"
                          data-stage={contact.stage}
                        >
                          {marketingStageLabels[contact.stage]}
                        </span>
                      </td>
                      <td className="marketing-column-purchases">
                        {contact.purchaseCount}
                      </td>
                      <td className="marketing-column-date">
                        {marketingDate(contact.lastSeenAt)}
                      </td>
                      <td className="marketing-contact-open">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelected(contact.id)}
                        >
                          <span>Ver contato</span>
                          <ChevronRight size={15} aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={page.total}
              page={query.offset / 25 + 1}
              pageSize={25}
              onChange={(value) =>
                setQuery((previous) => ({
                  ...previous,
                  offset: (value - 1) * 25,
                }))
              }
            />
          </>
        )}
      </section>
    </section>
  );
}
