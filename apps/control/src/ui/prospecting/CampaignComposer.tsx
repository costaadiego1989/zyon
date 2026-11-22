import { useCallback, useEffect, useState } from "react";
import type { ProspectCampaign, ProspectSegmentSummary } from "@zyon/shared-types";
import {
  blockers,
  Button,
  cents,
  money,
  ReadState,
  useAction,
  useResource,
  type PageProps,
} from "./screen-controls.js";

export const campaignStates = {
  draft: "Rascunho",
  freezing: "Congelando público",
  review_ready: "Em revisão",
  approved: "Aprovada",
  running: "Em execução",
  paused: "Pausada",
  completed: "Concluída",
};
type Options = {
  offers: Awaited<ReturnType<PageProps["api"]["offers"]>>;
  sender: Awaited<ReturnType<PageProps["api"]["sender"]>>;
  segments: ProspectSegmentSummary[];
  campaign: ProspectCampaign | null;
};
export function CampaignComposer(props: PageProps & { id?: string }) {
  const { api, id, onSessionExpired } = props;
  const load = useCallback(
    async (s: AbortSignal) => {
      const [offers, sender, campaign, first] = await Promise.all([
        api.offers(s),
        api.sender(s),
        id ? api.campaign(id, s) : null,
        api.segments(undefined, s),
      ]);
      const segments = first.items.slice();
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await api.segments(cursor, s);
        segments.push(...page.items);
        cursor = page.nextCursor;
      }
      return { offers, sender, campaign, segments };
    },
    [api, id]
  );
  const result = useResource(load, onSessionExpired);
  return (
    <section className="prospecting-page">
      <header>
        <h2>{id ? "Revisar campanha" : "Preparar campanha"}</h2>
        <p>Confira o público, a oferta e a mensagem antes da aprovação.</p>
      </header>
      {!result.data ? (
        <ReadState {...result} />
      ) : (
        <Editor key={id ?? "new"} {...props} data={result.data} reload={result.reload} />
      )}
    </section>
  );
}
function Editor(props: PageProps & { data: Options; reload: () => void }) {
  const { api, data, reload, onSessionExpired, navigate } = props,
    { sender, offers, segments } = data;
  const [campaign, setCampaign] = useState(data.campaign),
    [name, setName] = useState(campaign?.name ?? ""),
    [plan, setPlan] = useState(campaign?.offer?.planKey ?? ""),
    [tpl, setTpl] = useState(campaign?.template?.id ?? "");
  const [daily, setDaily] = useState(campaign?.limits?.dailyRecipients.toString() ?? ""),
    [budget, setBudget] = useState(campaign?.limits ? (campaign.limits.budget.amountCents / 100).toFixed(2) : "");
  const [sendWindow, setSendWindow] = useState(
    campaign?.sendWindow ?? { timezone: "America/Sao_Paulo", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }
  );
  const [segment, setSegment] = useState(""),
    [dirty, setDirty] = useState(false),
    [selection, setSelection] = useState(campaign?.selectionId ?? null);
  const loadJob = useCallback(
    (s: AbortSignal) => (selection && campaign ? api.selection(campaign.id, selection, s) : Promise.resolve(null)),
    [api, campaign, selection]
  );
  const job = useResource(loadJob, onSessionExpired);
  const action = useAction(props, "composer." + (data.campaign?.id ?? "new"), reload);
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    if (!selection || !campaign || !job.data || job.data.state === "failed") return;
    const abort = new AbortController();
    if (job.data.state === "complete") {
      if (campaign.state === "freezing")
        void api
          .campaign(campaign.id, abort.signal)
          .then((c) => {
            if (!abort.signal.aborted) setCampaign(c);
          })
          .catch(() => {
            if (!abort.signal.aborted) reload();
          });
    } else {
      const timer = globalThis.setTimeout(() => {
        job.reload();
        setPoll((x) => x + 1);
      }, 2500);
      return () => {
        abort.abort();
        clearTimeout(timer);
      };
    }
    return () => abort.abort();
  }, [api, campaign, selection, job.data, job.reload, poll, reload]);
  const template = sender.templates.find((t) => t.id === tpl),
    offer = offers.items.find((o) => o.planKey === plan),
    binding = sender.binding;
  const compatible = Boolean(
    binding &&
      template?.status === "APPROVED" &&
      template.category === "MARKETING" &&
      template.requiresParameters === false &&
      template.previewText?.trim() &&
      template.wabaId === binding.wabaId
  );
  let amount = 0;
  try {
    amount = Number(cents(budget));
  } catch {
    /* An empty or incomplete amount keeps the form in edit mode. */
  }
  const valid =
    name.trim() &&
    offer &&
    compatible &&
    Number.isInteger(Number(daily)) &&
    Number(daily) > 0 &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    sendWindow.weekdays.length &&
    sendWindow.start < sendWindow.end;
  const editable = !campaign || ["draft", "review_ready", "approved", "paused"].includes(campaign.state);
  const selected = segments.find((s) => s.id === segment);
  const reviewed =
    campaign &&
    !dirty &&
    compatible &&
    campaign.template?.revision === template?.revision &&
    campaign.message === template?.previewText &&
    campaign.offer?.version === offer?.version &&
    campaign.senderVersion === binding?.version &&
    campaign.senderBindingId === binding?.id;
  return (
    <>
      {action.feedback}
      <form
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !binding || !template || !offer) return;
          void action.run(async (id) => {
            const body = {
              name,
              planKey: offer.planKey,
              message: template.previewText!,
              template,
              senderBindingId: binding.id,
              senderVersion: binding.version,
              sendWindow,
              limits: { dailyRecipients: Number(daily), budget: { amountCents: amount, currency: "BRL" } },
              clientRequestId: id,
            };
            const saved = campaign
              ? await api.reviseCampaign(campaign.id, { ...body, expectedRevision: campaign.revision })
              : await api.createCampaign(body);
            setCampaign(saved);
            setSelection(saved.selectionId);
            setDirty(false);
            if (!campaign) navigate({ area: "campaigns", id: saved.id, filters: { view: "edit" } });
            return "Revisão " + saved.revision + " salva.";
          });
        }}
      >
        <div className="prospecting-fields">
          <label>
            Nome da campanha
            <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Plano
            <select aria-label="Plano" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">Selecionar plano</option>
              {offers.items.map((o) => (
                <option key={o.planKey} value={o.planKey}>
                  {o.name} · {money(o.price.amountCents, o.price.currency)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Template aprovado
            <select aria-label="Template aprovado" value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="">Selecionar template</option>
              {sender.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          <strong>Remetente Zyon</strong> · {binding?.displayPhoneNumber ?? "Sem vínculo"}
        </p>
        {offer && (
          <div>
            <p>
              {offer.name} · {money(offer.price.amountCents, offer.price.currency)} ·{" "}
              {offer.billingCycle === "monthly"
                ? "Mensal"
                : offer.billingCycle === "annual" || offer.billingCycle === "yearly"
                ? "Anual"
                : offer.billingCycle}
            </p>
            <details>
              <summary>Referência da oferta</summary>
              <p>{offer.version}</p>
            </details>
          </div>
        )}
        {template && (
          <section>
            <h3>Mensagem do template</h3>
            <p>{template.previewText ?? "Texto indisponível"}</p>
            {!compatible && (
              <p role="alert">
                {template.requiresParameters
                  ? "O template exige parâmetros ou mídia."
                  : "Template incompatível com esta campanha."}
              </p>
            )}
          </section>
        )}
        <div className="prospecting-fields">
          <label>
            Destinatários por dia
            <input
              required
              type="number"
              min="1"
              max="2147483647"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
            />
          </label>
          <label>
            Orçamento (R$)
            <input required inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label>
            Início da janela
            <input
              type="time"
              value={sendWindow.start}
              onChange={(e) => setSendWindow({ ...sendWindow, start: e.target.value })}
            />
          </label>
          <label>
            Fim da janela
            <input
              type="time"
              value={sendWindow.end}
              onChange={(e) => setSendWindow({ ...sendWindow, end: e.target.value })}
            />
          </label>
          <label>
            Fuso de referência
            <input
              value={sendWindow.timezone}
              onChange={(e) => setSendWindow({ ...sendWindow, timezone: e.target.value })}
            />
          </label>
        </div>
        <fieldset>
          <legend>Dias de envio</legend>
          <div className="prospecting-actions">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label, i) => (
              <label key={label} className="prospecting-check">
                <input
                  type="checkbox"
                  checked={sendWindow.weekdays.includes(i + 1)}
                  onChange={(e) =>
                    setSendWindow({
                      ...sendWindow,
                      weekdays: e.target.checked
                        ? [...sendWindow.weekdays, i + 1]
                        : sendWindow.weekdays.filter((n) => n !== i + 1),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <p>
          Um follow-up após 48 horas da entrega, se o contato ainda não respondeu. A janela segue o fuso do contato. O
          contador diário reinicia às 00h UTC. O portfólio da Meta considera 24 horas móveis.
        </p>
        {editable && (
          <Button type="submit" primary disabled={!valid || action.disabled}>
            {campaign ? "Salvar revisão" : "Salvar rascunho"}
          </Button>
        )}
      </form>
      {!segments.length && <p>Salve um segmento em Buscar empresas para preparar o público.</p>}
      {sender.blockers.map((b) => (
        <p key={b}>{blockers[b]}</p>
      ))}
      <p>O envio externo exige opt-in e um canal elegível.</p>
      {campaign && (
        <section className="prospecting-page">
          <header>
            <h3>
              {campaign.name} · {campaignStates[campaign.state]}
            </h3>
            <p>
              Revisão {campaign.revision} · {campaign.recipientCount} destinatários
            </p>
          </header>
          <dl>
            <div>
              <dt>Mensagem salva</dt>
              <dd>{campaign.message}</dd>
            </div>
            <div>
              <dt>Oferta revisada</dt>
              <dd>
                {campaign.offer?.name} ·{" "}
                {campaign.offer && money(campaign.offer.price.amountCents, campaign.offer.price.currency)}
              </dd>
            </div>
            <div>
              <dt>Limites aprováveis</dt>
              <dd>
                {campaign.limits
                  ? campaign.limits.dailyRecipients +
                    " destinatários/dia · " +
                    money(campaign.limits.budget.amountCents)
                  : "Limites ausentes"}
              </dd>
            </div>
            <div>
              <dt>Janela</dt>
              <dd>
                {campaign.sendWindow.start}–{campaign.sendWindow.end} · {campaign.sendWindow.timezone}
              </dd>
            </div>
          </dl>
          {!reviewed && !dirty && (
            <p role="status">Confira o vínculo, a oferta e o template vigentes e salve uma nova revisão.</p>
          )}
          {campaign.blockers.map((b) => (
            <p key={b}>{blockers[b]}</p>
          ))}
          {dirty && <p role="status">Salve as alterações para revisar o público.</p>}
          {editable && (
            <div className="prospecting-actions">
              <label>
                Segmento
                <select aria-label="Segmento" value={segment} onChange={(e) => setSegment(e.target.value)}>
                  <option value="">Selecionar segmento</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · v{s.version}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!selected || dirty || action.disabled}
                onClick={() =>
                  void action.run(async (id) => {
                    const frozen = await api.freeze(campaign.id, {
                      clientRequestId: id,
                      expectedRevision: campaign.revision,
                      snapshotId: selected!.snapshotId,
                      segmentId: selected!.id,
                      segmentVersion: selected!.version,
                    });
                    setCampaign(await api.campaign(campaign.id));
                    setSelection(frozen.selectionId);
                    return "Seleção registrada.";
                  })
                }
              >
                Congelar público
              </Button>
            </div>
          )}
          {selection &&
            (job.data ? (
              <p>
                Público{" "}
                {job.data.state === "complete"
                  ? "congelado"
                  : job.data.state === "failed"
                  ? "com falha"
                  : "em processamento"}{" "}
                · {job.data.companyCount} empresas · {job.data.recipientCount} destinatários ·{" "}
                {job.data.missingEndpointCount} sem contato
              </p>
            ) : (
              <ReadState {...job} />
            ))}
          {job.data?.eligibilityBlockers?.map((b) => (
            <p key={b.reason}>
              {blockers[b.reason]} · {b.recipients} destinatário(s)
            </p>
          ))}
          {campaign.state === "review_ready" && (
            <Button
              disabled={!reviewed || action.disabled || job.data?.state !== "complete"}
              onClick={() =>
                void action.run(async (id) => {
                  setCampaign(
                    await api.approve(campaign.id, {
                      clientRequestId: id,
                      expectedRevision: campaign.revision,
                      audienceHash: campaign.audienceHash!,
                      contentHash: campaign.contentHash!,
                    })
                  );
                  return "Revisão aprovada.";
                })
              }
            >
              Aprovar revisão
            </Button>
          )}
          {campaign.state === "approved" && (
            <Button
              disabled={!reviewed || action.disabled || sender.status !== "ready"}
              onClick={() =>
                void action.run(async (id) => {
                  const c = await api.start(campaign.id, { clientRequestId: id, expectedRevision: campaign.revision });
                  setCampaign(c);
                  return campaignStates[c.state];
                })
              }
            >
              Iniciar campanha
            </Button>
          )}
          <div className="prospecting-actions">
            <Button onClick={() => navigate({ area: "campaigns", id: campaign.id })}>Ver destinatários</Button>
            <Button onClick={reload}>Atualizar revisão</Button>
          </div>
        </section>
      )}
    </>
  );
}
