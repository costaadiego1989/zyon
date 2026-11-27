import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ProspectContact, ProspectConversionHistoryItem, ProspectRecord, ProspectStage } from "@zyon/shared-types";
import { ProspectChat } from "./ProspectChat.js";
import { ProspectingState, type ProspectRoute } from "./ProspectingShell.js";
import {
  Button,
  dateTime,
  money,
  ReadState,
  stages,
  useAction,
  useResource,
  type PageProps,
} from "./screen-controls.js";
export const conversionLabels: Record<ProspectConversionHistoryItem["state"], string> = {
  account_bound: "Conta vinculada",
  signup: "Cadastro",
  trial: "Período de teste",
  paid: "Pagamento confirmado",
  refunded: "Reembolso integral",
  allocation_coverage_unknown: "Cobertura de alocação desconhecida",
};
export const permissions = {
  opted_in: "Opt-in registrado",
  no_opt_in: "Sem opt-in",
  revoked: "Permissão revogada",
};
const confirmation = {
  ambiguous: "Vínculo ambíguo",
  confirmed: "Vínculo confirmado",
  unconfirmed: "Vínculo sem confirmação",
};
type Props = PageProps & {
  route: ProspectRoute;
  operators?: { id: string; label: string }[];
};
function phoneLabel(value: string) {
  const input = value.trim();
  if (!/^[+]?[(\d][() .\d-]*$/.test(input)) return value;
  let digits = input.replace(/\D/g, "");
  const withCountry = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
  if (input.startsWith("+") && !withCountry) return value;
  if (withCountry) digits = digits.slice(2);
  const parts = /^([1-9]\d)(9\d{4}|[2-5]\d{3})(\d{4})$/.exec(digits);
  return parts ? `(${parts[1]}) ${parts[2]}-${parts[3]}` : value;
}

function identityLabel(contact: ProspectContact) {
  if (contact.identity?.kind === "phone") return phoneLabel(contact.identity.value);
  return contact.identity?.value ?? contact.normalizedValue ?? "Identidade desconhecida";
}

export function ProspectDetailPage(props: Props) {
  const { api, navigate, onSessionExpired, route } = props;
  const search = route.filters?.search ?? "";
  const { campaignId, from, to, cursor } = route.filters ?? {};
  const [updated, setUpdated] = useState<Record<string, ProspectRecord>>({});
  const onRead = useCallback((lead: ProspectRecord) => {
    setUpdated((records) => (records[lead.id]?.version >= lead.version ? records : { ...records, [lead.id]: lead }));
  }, []);
  const searchInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : searchInput.current;
    target?.focus({ preventScroll: true });
  }, []);
  const load = useCallback(
    (signal: AbortSignal) =>
      api.prospects(
        {
          search: search || undefined,
          campaignId,
          from,
          to,
          cursor,
          limit: 30,
        },
        signal
      ),
    [api, search, campaignId, from, to, cursor]
  );
  const result = useResource(load, onSessionExpired);
  function filter(nextSearch: string, nextCursor?: string) {
    const filters = { ...route.filters };
    if (nextSearch) filters.search = nextSearch;
    else delete filters.search;
    if (nextCursor) filters.cursor = nextCursor;
    else delete filters.cursor;
    navigate({ area: "leads", filters });
  }
  return (
    <section className="prospecting-page">
      <header>
        <h2>Leads</h2>
        <p>Empresas adicionadas ao CRM.</p>
      </header>
      {(from || campaignId) && (
        <p>
          Período {dateTime(from)} até {dateTime(to)} · Campanha {campaignId ?? "Todas"}
        </p>
      )}
      <form
        className="prospecting-actions"
        onSubmit={(e) => {
          e.preventDefault();
          filter(String(new FormData(e.currentTarget).get("search") ?? "").trim());
        }}
      >
        <label>
          Buscar por CNPJ
          <input key={search} ref={searchInput} name="search" defaultValue={search} />
        </label>
        <Button type="submit">Pesquisar</Button>
      </form>
      {!result.data ? (
        <ReadState {...result} />
      ) : (
        <>
          {!result.data.items.length && <ProspectingState state="empty" message="Nenhum lead encontrado." />}
          <div>
            {result.data.items.map((row) => {
              const snapshot = updated[row.id];
              const p = snapshot && snapshot.version > row.version ? snapshot : row;
              const phone = p.contacts.find((contact) => contact.identity?.kind === "phone");
              return (
                <div key={p.id} className="prospecting-row">
                  <div>
                    <button
                      type="button"
                      className="button button--secondary"
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        navigate({ ...route, id: p.id });
                      }}
                    >
                      {p.cnpj}
                    </button>
                    {phone && <small>{identityLabel(phone)}</small>}
                  </div>
                  <span>{stages[p.stage]}</span>
                  <span>{p.lastReplyPreview ?? "Sem resposta recebida"}</span>
                </div>
              );
            })}
          </div>
          <div className="prospecting-actions">
            {cursor && <Button onClick={() => filter(search)}>Primeira página</Button>}
            {result.data.nextCursor && (
              <Button onClick={() => filter(search, result.data!.nextCursor!)}>Próxima página</Button>
            )}
          </div>
        </>
      )}
      {route.id && <Detail key={route.id} {...props} id={route.id} onRead={onRead} restoreFocus={restoreFocus} />}
    </section>
  );
}
function Conversions({ api, id, onSessionExpired }: Pick<Props, "api" | "onSessionExpired"> & { id: string }) {
  const [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<ProspectConversionHistoryItem[]>([]);
  const load = useCallback((s: AbortSignal) => api.conversions(id, { cursor, limit: 25 }, s), [api, id, cursor]);
  const result = useResource(load, onSessionExpired);
  return (
    <section>
      <h3>Histórico de conversão</h3>
      {!result.data ? (
        <ReadState {...result} />
      ) : (
        <>
          {!result.data.items.length && !previous.length && <p>Nenhuma conversão registrada.</p>}
          <ol>
            {[...previous, ...result.data.items].map((v) => (
              <li key={v.id}>
                <strong>{conversionLabels[v.state]}</strong> · {v.planKey} · {v.provider} · {dateTime(v.occurredAt)}
              </li>
            ))}
          </ol>
          {result.data.nextCursor && (
            <Button
              onClick={() => {
                setPrevious([...previous, ...result.data!.items]);
                setCursor(result.data!.nextCursor!);
              }}
            >
              Conversões anteriores
            </Button>
          )}
        </>
      )}
    </section>
  );
}
function Detail(
  props: Props & {
    id: string;
    onRead: (lead: ProspectRecord) => void;
    restoreFocus: () => void;
  }
) {
  const { api, id, onSessionExpired, operatorId, navigate, route, onRead, restoreFocus } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const node = dialog.current!;
    const root = document.documentElement;
    const original = root.style.overflow;
    node.showModal();
    root.style.overflow = "hidden";
    return () => {
      node.close();
      root.style.overflow = original;
      restoreFocus();
    };
  }, [restoreFocus]);
  function dismiss() {
    navigate({ area: "leads", filters: route.filters });
  }
  const load = useCallback((s: AbortSignal) => api.prospect(id, s), [api, id]);
  const result = useResource(load, onSessionExpired);
  const action = useAction(props, "lead." + id, result.reload);
  const [confirm, setConfirm] = useState(false),
    [reason, setReason] = useState(""),
    [chat, setChat] = useState(false);
  const detail = result.data,
    p = detail?.prospect,
    c = detail?.company;
  useEffect(() => {
    if (p) onRead(p);
  }, [p, onRead]);
  return (
    <dialog
      ref={dialog}
      className="detail-drawer prospect-lead-drawer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']"
          )
        ).filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls[controls.length - 1];
        const next =
          event.shiftKey && document.activeElement === first
            ? last
            : !event.shiftKey && document.activeElement === last
            ? first
            : null;
        if (next) {
          event.preventDefault();
          next.focus();
        }
      }}
    >
      <header className="detail-drawer__header">
        <div>
          <p className="eyebrow">Ficha do lead</p>
          <h2 id={titleId}>{c?.legalName ?? p?.cnpj ?? "Dados do lead"}</h2>
          {p && (
            <span>
              {p.cnpj} · Competência {c?.competence ?? "indisponível"}
            </span>
          )}
        </div>
        <button className="icon-button" type="button" onClick={dismiss} aria-label="Fechar ficha do lead">
          <X size={19} aria-hidden="true" />
          <span className="visually-hidden">Fechar ficha do lead</span>
        </button>
      </header>
      <div className="detail-drawer__content prospecting-page">
        {action.feedback}
        {!p || !detail ? (
          <ReadState {...result} />
        ) : (
          <>
            {!p.suppressed && (
              <form
                key={p.version}
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void action.run(async (k) => {
                    await api.updateProspect(id, {
                      clientRequestId: k,
                      expectedVersion: p.version,
                      ...(data.has("stage") && data.get("stage") !== p.stage
                        ? { stage: data.get("stage") as ProspectStage }
                        : {}),
                      assignedOperatorId: String(data.get("owner") || "") || null,
                      tags: String(data.get("tags") ?? "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                    result.reload();
                    return "Lead atualizado.";
                  });
                }}
              >
                <h3>Editar lead</h3>
                <div className="prospecting-fields">
                  <label>
                    Alterar estágio
                    <select
                      aria-label="Alterar estágio"
                      name="stage"
                      defaultValue={p.stage}
                      disabled={p.stage === "converted"}
                    >
                      {Object.entries(stages)
                        .filter(([k]) => k !== "do_not_contact" && (k !== "converted" || p.stage === "converted"))
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Atribuir responsável
                    <select aria-label="Atribuir responsável" name="owner" defaultValue={p.assignedOperatorId ?? ""}>
                      <option value="">Sem responsável</option>
                      {[
                        ...new Map(
                          [
                            { id: operatorId, label: "Eu" },
                            ...(p.assignedOperatorId
                              ? [
                                  {
                                    id: p.assignedOperatorId,
                                    label: p.assignedOperatorId,
                                  },
                                ]
                              : []),
                            ...(props.operators ?? []),
                          ].map((o) => [o.id, o])
                        ).values(),
                      ].map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Etiquetas separadas por vírgula
                    <input name="tags" defaultValue={p.tags.join(", ")} />
                  </label>
                </div>
                <Button primary disabled={action.disabled} type="submit">
                  Salvar lead
                </Button>
              </form>
            )}
            <section>
              <h3>Contatos cadastrais</h3>
              {c?.contacts.length ? (
                c.contacts.map((a, i) => (
                  <p key={i}>
                    {a.channel === "phone" ? "Telefone" : "E-mail"} ·{" "}
                    {a.channel === "phone" ? phoneLabel(a.originalValue) : a.originalValue}
                  </p>
                ))
              ) : (
                <p>Sem contato na fonte.</p>
              )}
            </section>
            <section>
              <h3>Identidade e permissão</h3>
              {!p.contacts.length && <p>Nenhum vínculo de contato.</p>}
              {p.contacts.map((a) => (
                <div key={a.endpointId} className="prospecting-row">
                  <div>
                    <strong>{identityLabel(a)}</strong>
                    <small>
                      {a.identity?.kind === "bsuid" ? "Identificador do provedor · " : ""}
                      {confirmation[a.confirmationState]} · {permissions[a.permission]}
                    </small>
                  </div>
                  {!p.suppressed && a.confirmationState !== "confirmed" && (
                    <form
                      className="prospecting-actions"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const ref = String(new FormData(e.currentTarget).get("ref")).trim();
                        if (ref)
                          void action.run(async (k) => {
                            await api.bindContact(id, {
                              clientRequestId: k,
                              expectedVersion: p.version,
                              endpointId: a.endpointId,
                              evidenceRef: ref,
                            });
                            result.reload();
                            return "Vínculo confirmado pelo servidor.";
                          });
                      }}
                    >
                      <label>
                        Referência da evidência
                        <input required name="ref" />
                      </label>
                      <Button type="submit" disabled={action.disabled}>
                        Confirmar identidade
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </section>
            <section>
              <h3>Cadastro e atividade</h3>
              <dl>
                {Object.entries({
                  "Nome fantasia": c?.tradeName,
                  Localização: [c?.district, c?.uf].filter(Boolean).join(" · "),
                  "CNAE principal": c?.mainCnae,
                  "Capital social": c?.capitalCents ? money(c.capitalCents) : null,
                  Estágio: stages[p.stage],
                  Responsável:
                    props.operators?.find((x) => x.id === p.assignedOperatorId)?.label ?? p.assignedOperatorId,
                  "Primeira tentativa": dateTime(p.firstAttemptAt),
                  "Última tentativa": dateTime(p.lastAttemptAt),
                  "Primeira entrega": dateTime(p.firstDeliveredAt),
                  "Última entrega": dateTime(p.lastDeliveredAt),
                  "Última resposta recebida": p.lastReplyPreview,
                  "Recebida em": dateTime(p.lastReplyAt),
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || "Sem registro"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {p.suppressed ? (
              <p>
                <strong>Contato bloqueado</strong>
              </p>
            ) : confirm ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async (k) => {
                    const receipt = await api.suppress(id, {
                      clientRequestId: k,
                      expectedVersion: p.version,
                      reason: reason.trim(),
                    });
                    result.reload();
                    setConfirm(false);
                    return (
                      "Contato bloqueado. " +
                      receipt.cancelledAttempts +
                      " cancelada(s) e " +
                      receipt.inFlightAttempts +
                      " em andamento."
                    );
                  });
                }}
              >
                <h3>Bloquear novos contatos com esta empresa?</h3>
                <label>
                  Motivo do bloqueio
                  <input required value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="prospecting-actions">
                  <Button type="submit" disabled={action.disabled || !reason.trim()}>
                    Confirmar não contatar
                  </Button>
                  <Button onClick={() => setConfirm(false)}>Cancelar</Button>
                </div>
              </form>
            ) : (
              <div>
                <Button onClick={() => setConfirm(true)} disabled={action.disabled}>
                  Não contatar
                </Button>
              </div>
            )}
            <Conversions api={api} id={id} onSessionExpired={onSessionExpired} />
            {detail.conversationId ? (
              <>
                {chat ? (
                  <ProspectChat
                    api={api}
                    operatorId={operatorId}
                    onSessionExpired={onSessionExpired}
                    conversationId={detail.conversationId}
                  />
                ) : (
                  <div>
                    <Button onClick={() => setChat(true)}>Abrir conversa</Button>
                  </div>
                )}
              </>
            ) : (
              <p>Nenhuma conversa vinculada à empresa.</p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
