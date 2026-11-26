import { useEffect, useMemo, useRef, useState } from "react";
import { ServiceBookingClient, ServiceBookingReadClient, serviceBookingContext, ServiceBookingRequestError, ServiceBookingUncertainError, type ServiceBookingReadAccess, type ServiceBookingAccess, type ServicePreparation, type ServiceProfessional, type ServiceReview, type ServiceSelection, type ServiceConfirmation } from "../../api/service-booking";
import "./ServiceBookingPicker.css";

export type ServiceBookingPickerProps = {
  data: unknown;
  access: ServiceBookingAccess | null;
  readAccess?: ServiceBookingReadAccess | null;
  cartRef?: string;
  buyerIdentity?: string | null;
  authenticationPending?: boolean;
  authenticationFailed?: boolean;
  onAuthenticate?: (onCancel?: () => void) => void;
  onRefreshContext?: () => void;
  /** Opens the existing payment surface, keeping this exact authenticated session. */
  onCheckout?: (prepared: ServicePreparation) => void;
  /** Explicitly reviews the prepared parent through the existing checkout/start authority. */
  onReviewCheckout?: () => Promise<void>;
  initialFromDate?: string;
};
type View = { key: string; professionals: ServiceProfessional[]; more: boolean; professional?: ServiceProfessional; dates: string[]; date?: string; slots: ServiceSelection[]; selected?: ServiceSelection; readPrivateKey?: string; privateKey?: string; busyPrivate?: boolean; errorPrivate?: boolean; review?: ServiceReview; prepared?: ServicePreparation; confirmed?: ServiceConfirmation; busy: boolean; error?: "auth" | "permission" | "conflict" | "unavailable" | "uncertain" | "hold"; loaded: boolean; page: number; slotPage: number };
type PendingContinuation = { id: number; key: string; selected: ServiceSelection; buyer?: string; phase: "authentication" | "resuming" };
function todayBrasilia() { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type: string) => parts.find(p => p.type === type)!.value; return `${get("year")}-${get("month")}-${get("day")}`; }
function windowEnd(date: string) { const value = new Date(`${date}T12:00:00Z`); if (!Number.isFinite(value.getTime())) return date; value.setUTCDate(value.getUTCDate() + 30); return value.toISOString().slice(0, 10); }
const dateLabel = (date: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(`${date}T12:00:00Z`));
const timeLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
const instantDateLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(value));
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const blank = (key: string): View => ({ key, professionals: [], more: false, dates: [], slots: [], busy: false, loaded: false, page: 0, slotPage: 0 });

export function ServiceBookingPicker({ data, access, readAccess, cartRef, buyerIdentity, authenticationPending = false, authenticationFailed = false, onAuthenticate, onRefreshContext, onCheckout, onReviewCheckout, initialFromDate }: ServiceBookingPickerProps) {
  const parsed = serviceBookingContext(data);
  const contextKey = parsed ? JSON.stringify(parsed) : "";
  const context = useMemo(() => parsed, [contextKey]);
  const publicAccess = readAccess === undefined ? access : readAccess;
  const readMerchant = publicAccess?.merchantId, readToken = publicAccess?.embedToken, readBase = publicAccess?.apiBaseUrl, readEmbedBase = publicAccess?.embedApiBaseUrl;
  const browse = useMemo(() => publicAccess ? new ServiceBookingReadClient(publicAccess) : null, [readMerchant, readToken, readBase, readEmbedBase]);
  const merchant = access?.merchantId, buyer = access?.globalUserId, embed = access?.embedToken, buyerToken = access?.buyerAccessToken, base = access?.apiBaseUrl, embedBase = access?.embedApiBaseUrl;
  const client = useMemo(() => access && merchant === readMerchant ? new ServiceBookingClient(access) : null, [readMerchant, merchant, buyer, embed, buyerToken, base, embedBase]);
  const publicIdentity = JSON.stringify([readMerchant, cartRef, readToken, readBase, readEmbedBase, contextKey]);
  const publicGeneration = useRef({ identity: publicIdentity, generation: 0 });
  if (publicGeneration.current.identity !== publicIdentity) publicGeneration.current = { identity: publicIdentity, generation: publicGeneration.current.generation + 1 };
  const scopeKey = JSON.stringify([publicIdentity, publicGeneration.current.generation]);
  const privateIdentity = JSON.stringify([scopeKey, merchant, buyer, embed, buyerToken, base, embedBase]);
  const privateGeneration = useRef({ identity: privateIdentity, generation: 0 });
  if (privateGeneration.current.identity !== privateIdentity) privateGeneration.current = { identity: privateIdentity, generation: privateGeneration.current.generation + 1 };
  const privateKey = JSON.stringify([privateIdentity, privateGeneration.current.generation]);
  const [fromDate, setFromDate] = useState(initialFromDate ?? todayBrasilia);
  const [view, setView] = useState<View>(() => blank(scopeKey));
  const [observedTime, setObservedTime] = useState(Date.now);
  const current = useRef(scopeKey); current.current = scopeKey;
  const currentPrivate = useRef(privateKey); currentPrivate.current = privateKey;
  const previousPrivateKey = useRef(privateKey);
  const epoch = useRef(0); const pending = useRef<AbortController | null>(null); const pendingPrivate = useRef(false);
  const continuation = useRef<PendingContinuation | null>(null), continuationSequence = useRef(0);
  const identifiedBuyer = buyerIdentity === undefined ? buyer ?? null : buyerIdentity;
  const panel = useRef<HTMLElement | null>(null);
  // Public choices survive guest identification. Private facts are masked during
  // render, before effects, whenever the buyer, token, cart or merchant changes.
  function visible(old: View): View {
    if (old.key !== scopeKey) return blank(scopeKey);
    if (old.readPrivateKey && (!client || old.readPrivateKey !== privateKey)) return blank(scopeKey);
    if (client && old.privateKey === privateKey) return old;
    return { ...old, review: undefined, prepared: undefined, confirmed: undefined,
      busy: old.busyPrivate ? false : old.busy, error: old.errorPrivate ? undefined : old.error };
  }
  const state = visible(view);
  const selectedNow = useRef(state.selected); selectedNow.current = state.selected;
  const expiresAt = state.prepared?.service_slot_hold?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    setObservedTime(Date.now());
    const timer = setTimeout(() => setObservedTime(Date.now()), Math.max(0, Date.parse(expiresAt) - Date.now()) + 5);
    return () => clearTimeout(timer);
  }, [scopeKey, privateKey, expiresAt]);
  async function perform(work: (signal: AbortSignal, isCurrent: () => boolean) => Promise<Partial<View>>, reset?: Partial<View>, privateRequest = false) {
    if (current.current !== scopeKey || privateRequest && !client) return;
    const key = scopeKey, authorization = privateKey, ownEpoch = ++epoch.current;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; pendingPrivate.current = privateRequest;
    setView(old => ({ ...visible(old), ...reset, busy: true, busyPrivate: privateRequest, error: undefined,
      errorPrivate: privateRequest, ...(privateRequest ? { privateKey: authorization } : {}) }));
    const isCurrent = () => current.current === key && epoch.current === ownEpoch && !controller.signal.aborted
      && (!privateRequest || currentPrivate.current === authorization);
    try {
      const result = await work(controller.signal, isCurrent);
      if (!isCurrent()) return;
      pendingPrivate.current = false;
      setView(old => ({ ...old, ...result, busy: false }));
    } catch (error) {
      if (!isCurrent()) return;
      pendingPrivate.current = false;
      const kind = error instanceof ServiceBookingUncertainError ? "uncertain" : privateRequest && error instanceof ServiceBookingRequestError && error.status === 401 ? "auth" : privateRequest && error instanceof ServiceBookingRequestError && error.status === 403 ? "permission" : error instanceof ServiceBookingRequestError && error.code === "service_hold_required" ? "hold" : error instanceof ServiceBookingRequestError && [409, 410, 412].includes(error.status) ? "conflict" : "unavailable";
      if (kind === "auth" || kind === "permission") { continuation.current = null; setView({ ...blank(key), privateKey: authorization, error: kind, errorPrivate: true }); return; }
      setView(old => ({ ...old, busy: false, error: kind,
        ...(kind === "conflict" ? { selected: undefined, review: undefined, prepared: undefined, slots: [] } : {}) }));
    }
  }
  function readProfessionals(reader: ServiceBookingReadClient | null) {
    continuation.current = null;
    if (!reader || !context) return;
    const privateRead = reader === client;
    void perform(async signal => { const result = await reader.professionals(context, signal); return { professionals: result.professionals, more: result.has_more, loaded: true }; }, { ...blank(scopeKey), readPrivateKey: privateRead ? privateKey : undefined }, privateRead);
  }
  function loadProfessionals() { readProfessionals(client && state.error !== "auth" && state.error !== "permission" ? client : browse); }
  function loadPublicProfessionals() { readProfessionals(browse); }
  useEffect(() => {
    readProfessionals(client ?? browse);
    return () => { ++epoch.current; pending.current?.abort(); };
  }, [browse, contextKey]);
  useEffect(() => {
    if (previousPrivateKey.current === privateKey) return;
    previousPrivateKey.current = privateKey;
    // A public scope transition already owns its cleanup/new reader request.
    if (view.key !== scopeKey) return;
    if (pendingPrivate.current) { ++epoch.current; pending.current?.abort(); pendingPrivate.current = false; }
    if (view.readPrivateKey && view.readPrivateKey !== privateKey) { readProfessionals(client ?? browse); return; }
    setView(old => ({ ...visible(old), privateKey: undefined, review: undefined, prepared: undefined, confirmed: undefined,
      busy: old.busyPrivate ? false : old.busy, busyPrivate: false, error: old.errorPrivate ? undefined : old.error, errorPrivate: false }));
  }, [privateKey]);
  function cancelContinuation(id: number) {
    if (continuation.current?.id !== id) return;
    continuation.current = null; ++epoch.current; pending.current?.abort(); pendingPrivate.current = false;
    setView(old => ({ ...visible(old), busy: false, busyPrivate: false, error: undefined,
      review: undefined, prepared: undefined, confirmed: undefined, privateKey: undefined }));
  }
  async function reviewSelected(selected: ServiceSelection, consumeIntent?: () => boolean) {
    if (!browse || !context || !client) return;
    await perform(async (signal, isCurrent) => {
      const currentOrAbort = () => { if (!isCurrent()) throw new DOMException("Superseded selection", "AbortError"); };
      const [professionals, dates, slots] = await Promise.all([
        client.professionals(context, signal),
        client.dates(context, selected.professionalId, selected.date, selected.date, signal),
        client.slots(context, selected.professionalId, selected.date, signal),
      ]);
      currentOrAbort();
      const professional = professionals.professionals.find(p => p.id === selected.professionalId && p.version === selected.professionalVersion);
      if (!professional) throw new ServiceBookingRequestError(409, "service_professional_changed");
      if (dates.professional_version !== selected.professionalVersion || dates.policy_version !== selected.policyVersion || !dates.dates.includes(selected.date)) throw new ServiceBookingRequestError(409, "service_slot_unavailable");
      const fresh = slots.selections.find(row => row.slotId === selected.slotId && Object.keys(row).every(key => row[key as keyof ServiceSelection] === selected[key as keyof ServiceSelection]));
      if (!fresh) throw new ServiceBookingRequestError(409, "service_slot_unavailable");
      if (consumeIntent && !consumeIntent()) throw new DOMException("Cancelled continuation", "AbortError");
      currentOrAbort();
      return { selected: fresh, professional, readPrivateKey: privateKey, review: await client.select(fresh, signal) };
    }, { review: undefined, prepared: undefined, confirmed: undefined }, true);
  }
  useEffect(() => {
    const intent = continuation.current;
    if (!intent) return;
    if (intent.key !== scopeKey || authenticationFailed || !selectedNow.current
      || JSON.stringify(intent.selected) !== JSON.stringify(selectedNow.current)
      || intent.buyer && intent.buyer !== identifiedBuyer) { cancelContinuation(intent.id); return; }
    if (!identifiedBuyer) return;
    if (!intent.buyer) intent.buyer = identifiedBuyer;
    if (!client || buyer !== intent.buyer || intent.phase !== "authentication") return;
    intent.phase = "resuming";
    // Consume the original gesture once, only after all three public facts have
    // been revalidated under this exact buyer. Never prepare or confirm here.
    void reviewSelected(intent.selected, () => {
      if (continuation.current !== intent || intent.key !== current.current || intent.buyer !== buyer) return false;
      continuation.current = null; return true;
    }).finally(() => { if (continuation.current === intent) continuation.current = null; });
  }, [scopeKey, privateKey, identifiedBuyer, authenticationFailed, client]);
  useEffect(() => { if (state.error || state.selected || state.review || state.prepared || state.confirmed) panel.current?.focus({ preventScroll: true }); }, [state.error, state.selected, state.review, state.prepared, state.confirmed]);
  if (!context) return <section className="zyon-booking" aria-label="Agendar serviço"><h3>Vamos escolher seu atendimento</h3><p>Selecione o serviço novamente para consultar profissionais e horários atualizados.</p>{onRefreshContext && <button type="button" onClick={onRefreshContext}>Consultar serviço</button>}</section>;
  if (!browse) return <section className="zyon-booking" aria-label="Agendar serviço"><h3>Seu próximo atendimento</h3><p role="status">Conectando a consulta de disponibilidade…</p></section>;
  const clearChoice = { selected: undefined, review: undefined, prepared: undefined, confirmed: undefined, privateKey: undefined };
  const changeProfessional = (p: ServiceProfessional) => { continuation.current = null; const reader = client ?? browse; const privateRead = reader === client; void perform(async signal => { const result = await reader.dates(context, p.id, fromDate, windowEnd(fromDate), signal); if (result.professional_version !== p.version) throw new ServiceBookingRequestError(409, "service_professional_changed"); return { professional: p, dates: result.dates }; }, { ...clearChoice, readPrivateKey: privateRead ? privateKey : undefined, professional: undefined, dates: [], date: undefined, slots: [], slotPage: 0 }, privateRead); };
  const changeDate = (date: string) => { if (!state.professional) return; continuation.current = null; const reader = client ?? browse; const privateRead = reader === client; const p = state.professional; void perform(async signal => { const result = await reader.slots(context, p.id, date, signal); if (result.selections.some(row => row.professionalVersion !== p.version)) throw new ServiceBookingRequestError(409, "service_professional_changed"); return { date, slots: result.selections, slotPage: 0 }; }, { ...clearChoice, readPrivateKey: privateRead ? privateKey : undefined, date: undefined, slots: [] }, privateRead); };
  const chooseSlot = (slot: ServiceSelection) => {
    continuation.current = null; ++epoch.current; pending.current?.abort(); pendingPrivate.current = false;
    setView(old => ({ ...visible(old), ...clearChoice, selected: slot, busy: false, busyPrivate: false, error: undefined, errorPrivate: false }));
  };
  const continueSelection = () => {
    const selected = state.selected;
    if (!selected || authenticationPending) return;
    if (!client || state.error === "auth") {
      if (!onAuthenticate || continuation.current) return;
      if (!identifiedBuyer && state.error !== "auth") {
        const intent: PendingContinuation = { id: ++continuationSequence.current, key: scopeKey, selected: { ...selected }, phase: "authentication" };
        continuation.current = intent;
        onAuthenticate(() => cancelContinuation(intent.id));
      } else { continuation.current = null; onAuthenticate(); }
      return;
    }
    void reviewSelected(selected);
  };
  const uncertain = state.error === "uncertain";
  const locked = state.busy || uncertain || !!state.confirmed;
  const privateLocked = locked || state.error === "auth" || state.error === "permission";
  const review = state.review, prepared = state.prepared;
  const holdExpired = !!expiresAt && Date.parse(expiresAt) <= Math.max(observedTime, Date.now());
  const preparedSelection = prepared?.selections.find(item => item.slotId === review?.selection.slotId);
  const summary = preparedSelection ?? review?.selection ?? state.selected;
  const serviceName = preparedSelection?.productName ?? review?.service.name ?? context.serviceName;
  const professionalName = preparedSelection?.professionalName ?? review?.professional.name ?? state.professional?.name;
  const confirmed = state.confirmed?.appointments[0];
  return <section ref={panel} tabIndex={-1} className="zyon-booking" aria-label="Agendar serviço" aria-busy={state.busy}>
    <header className="zyon-booking__header"><span className="zyon-booking__eyebrow">Seu atendimento</span><h3>{context.serviceName}</h3><p>Escolha com tranquilidade. Horários no fuso de Brasília.</p></header>
    <ol className="zyon-booking__steps" aria-label="Etapas do agendamento"><li aria-current={!state.professional ? "step" : undefined}>Profissional</li><li aria-current={state.professional && !review ? "step" : undefined}>Horário</li><li aria-current={review && !confirmed ? "step" : undefined}>Revisão</li></ol>
    {state.error && <div className="zyon-booking__notice" role="alert">
      {state.error === "auth" && <><p>Sua identificação precisa ser atualizada para continuar.</p>{onAuthenticate && <button type="button" onClick={() => onAuthenticate()}>Identificar-me para agendar</button>}<button type="button" onClick={loadPublicProfessionals}>Consultar disponibilidade</button></>}
      {state.error === "permission" && <p>Esta conversa não permite iniciar outro agendamento agora. Se você já iniciou um pagamento, acompanhe o pedido atual pelo menu da loja. Você também pode falar com o atendimento.</p>}
      {state.error === "conflict" && <><p>Este horário ou as condições mudaram. Consulte novamente antes de continuar.</p><button type="button" onClick={loadProfessionals}>Atualizar disponibilidade</button></>}
      {state.error === "unavailable" && <><p>Não foi possível consultar o atendimento agora.</p><button type="button" onClick={loadProfessionals}>Atualizar disponibilidade</button></>}
      {uncertain && <p>Não foi possível confirmar o resultado da solicitação. Antes de tentar de novo, consulte seus agendamentos ou fale com o atendimento. Não repetiremos a ação automaticamente.</p>}
      {state.error === "hold" && <><p>Precisamos revisar a reserva temporária antes de continuar.</p>{onReviewCheckout && <button type="button" disabled={state.busy} onClick={() => void perform(async () => { await onReviewCheckout(); return {}; }, undefined, true)}>Revalidar reserva</button>}</>}
    </div>}
    {state.busy && <p className="zyon-booking__status" role="status">Consultando informações atualizadas…</p>}
    {!confirmed && !prepared && !review && !uncertain && <>
      <fieldset disabled={locked}><legend>1. Com quem deseja agendar?</legend><div className="zyon-booking__choices">{state.professionals.slice(state.page * 10, state.page * 10 + 10).map(p => <button type="button" key={p.id} aria-pressed={state.professional?.id === p.id} onClick={() => changeProfessional(p)}>{p.name}</button>)}</div>
        {state.loaded && !state.professionals.length && <p>Nenhum profissional disponível para este serviço agora.</p>}
        {state.professionals.length > 10 && <nav aria-label="Profissionais carregados"><button type="button" disabled={state.page === 0} onClick={() => setView(old => ({ ...old, page: old.page - 1 }))}>Anteriores</button><span>Página {state.page + 1} de {Math.ceil(state.professionals.length / 10)}</span><button type="button" disabled={(state.page + 1) * 10 >= state.professionals.length} onClick={() => setView(old => ({ ...old, page: old.page + 1 }))}>Próximos</button></nav>}
        {state.more && <p>Exibimos os primeiros profissionais retornados. Há outras opções; peça ajuda ao atendimento para consultá-las.</p>}
      </fieldset>
      <fieldset disabled={locked}><legend>2. Qual é o melhor dia?</legend><label className="zyon-booking__range">Consultar 31 dias a partir de<input type="date" value={fromDate} onChange={event => { continuation.current = null; ++epoch.current; pending.current?.abort(); pendingPrivate.current = false; setFromDate(event.target.value); setView(old => ({ ...visible(old), ...clearChoice, professional: undefined, dates: [], date: undefined, slots: [], busy: false, busyPrivate: false, error: undefined, errorPrivate: false })); }} /></label>
        <p className="zyon-booking__muted">{state.professional ? `${state.professional.name} · selecione uma data disponível` : "Escolha um profissional para consultar este período."}</p>
        <div className="zyon-booking__choices">{state.dates.map(date => <button type="button" key={date} aria-pressed={state.date === date} onClick={() => changeDate(date)}>{dateLabel(date)}</button>)}</div>
        {state.professional && !state.busy && !state.dates.length && <p>Nenhuma data disponível neste período. Escolha outro período ou profissional.</p>}
      </fieldset>
      {state.date && <fieldset disabled={locked}><legend>3. Escolha o horário · {dateLabel(state.date)}</legend><div className="zyon-booking__choices zyon-booking__times">{state.slots.slice(state.slotPage * 12, state.slotPage * 12 + 12).map(slot => <button type="button" key={slot.slotId} onClick={() => chooseSlot(slot)}>{timeLabel(slot.startsAt)}<small>{slot.durationMinutes} min · {money(slot.priceInCents, slot.currency)}</small></button>)}</div>
        {!state.slots.length && !state.busy && <p>Não há horários disponíveis nesta data. Escolha outro dia.</p>}
        {state.slots.length > 12 && <nav aria-label="Horários carregados"><button type="button" disabled={!state.slotPage} onClick={() => setView(old => ({ ...old, slotPage: old.slotPage - 1 }))}>Anteriores</button><span>{state.slotPage + 1} de {Math.ceil(state.slots.length / 12)}</span><button type="button" disabled={(state.slotPage + 1) * 12 >= state.slots.length} onClick={() => setView(old => ({ ...old, slotPage: old.slotPage + 1 }))}>Próximos</button></nav>}
      </fieldset>}
    </>}
    {summary && !uncertain && !confirmed && <div className="zyon-booking__summary"><span className="zyon-booking__eyebrow">Confira sua escolha</span><h4>{serviceName}</h4><dl><div><dt>Profissional</dt><dd>{professionalName}</dd></div><div><dt>Quando</dt><dd>{dateLabel(summary.date)} · {timeLabel(summary.startsAt)}<small>Horário de Brasília</small></dd></div><div><dt>Duração</dt><dd>{summary.durationMinutes} minutos</dd></div><div><dt>Valor do serviço</dt><dd className="zyon-booking__price">{money(summary.priceInCents, summary.currency)}</dd></div></dl>
      <p>{!prepared && !review ? "Continue para revisar as condições antes de confirmar. Sua escolha ainda não reserva um horário." : (prepared?.payment_mode ?? review?.policy.paymentMode) === "online" ? "Pagamento online. O agendamento depende da conclusão do pagamento e da confirmação da disponibilidade." : "Pagamento no atendimento. A confirmação abaixo registrará seu agendamento com pagamento pendente."}</p>
      {prepared && prepared.selections.length > 1 && <div><h4>Também neste agendamento</h4>{prepared.selections.filter(item => item.slotId !== summary.slotId).map(item => <p key={item.slotId}>{item.productName} · {item.professionalName}<br />{dateLabel(item.date)} · {timeLabel(item.startsAt)} · {item.durationMinutes} min · {money(item.priceInCents, item.currency)}</p>)}<p>Ao concluir, todos os {prepared.selections.length} atendimentos acima serão enviados para confirmação.</p></div>}
      {prepared?.service_slot_hold && <p>Reserva temporária até {timeLabel(prepared.service_slot_hold.expiresAt)} de {instantDateLabel(prepared.service_slot_hold.expiresAt)}. A disponibilidade será conferida novamente.</p>}
      {holdExpired && <div className="zyon-booking__notice" role="alert"><p>A reserva temporária expirou. Revise a disponibilidade antes de continuar.</p>{onReviewCheckout && <button type="button" disabled={locked} onClick={() => void perform(async () => { await onReviewCheckout(); return { prepared: undefined }; }, undefined, true)}>Revalidar reserva</button>}</div>}
      {!prepared?.service_slot_hold && <p>O horário ainda será validado ao concluir. Esta revisão não garante uma vaga.</p>}
      <div className="zyon-booking__actions">{!review && !prepared && state.selected && (client || onAuthenticate) && <button className="zyon-booking__primary" type="button" disabled={locked || authenticationPending || state.error === "permission"} onClick={continueSelection}>{authenticationPending ? "Verificando identificação…" : "Continuar agendamento"}</button>}{!review && !prepared && state.selected && !client && !onAuthenticate && <p className="zyon-booking__muted">Para confirmar o agendamento, volte à loja e continue sua compra.</p>}{!prepared && review && <button className="zyon-booking__primary" type="button" disabled={privateLocked || state.error === "hold" || !client} onClick={() => client && void perform(async signal => ({ prepared: await client.prepare(review, signal) }), undefined, true)}>Revisar agendamento</button>}
        {prepared?.payment_mode === "at_attendance" && <button className="zyon-booking__primary" type="button" disabled={privateLocked || holdExpired || !client} onClick={() => client && void perform(async signal => ({ confirmed: await client.confirm(prepared, signal) }), undefined, true)}>Confirmar e pagar no atendimento</button>}
        {prepared?.payment_mode === "online" && onCheckout && <button className="zyon-booking__primary" type="button" disabled={privateLocked || holdExpired} onClick={() => onCheckout(prepared)}>Continuar para pagamento</button>}
        {prepared?.payment_mode === "online" && !onCheckout && <p>Continue pelo pagamento seguro da loja. Se ele não estiver disponível, fale com o atendimento.</p>}
        <button type="button" disabled={locked} onClick={loadProfessionals}>Alterar escolha</button></div>
    </div>}
    {confirmed && <div className="zyon-booking__summary" role="status"><span className="zyon-booking__eyebrow">Seu atendimento</span><h4>{state.confirmed!.appointments.every(item => item.operationalStatus === "scheduled") ? "Agendamento confirmado" : "Agendamento atualizado"}</h4>{state.confirmed!.appointments.map(item => { const source = prepared!.selections.find(row => row.productId === item.productId && row.variantId === item.variantId && row.professionalId === item.professionalId && row.startsAt === item.startsAt)!; return <div key={item.id}><p>{source.productName} · {source.professionalName}<br />{instantDateLabel(item.startsAt)} · {timeLabel(item.startsAt)}</p><p>{item.payments.some(p => p.status === "pending") ? "Pagamento pendente no atendimento." : item.payments.every(p => p.status === "approved") && item.payments.length ? "Pagamento registrado." : "Consulte a situação do pagamento nos seus agendamentos."}</p></div>; })}<p className="zyon-booking__muted">Acompanhe ou solicite alterações nos seus agendamentos pelo menu da loja.</p></div>}
  </section>;
}
