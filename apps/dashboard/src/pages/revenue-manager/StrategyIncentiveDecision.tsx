import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import type { IncentiveDecision, IncentiveReview, IncentiveAlternativeCommand } from "../../api/endpoints/incentive-review.js";
import { decisionMayHaveSucceeded, formatReviewDate as date } from "./strategy-review-model.js";
import { strategyChanged } from "./strategy-review.js";
import type { IncentiveBenefitLabel } from "./incentive-recommendation-model.js";

type Pending = { kind: IncentiveDecision | "alternative"; input: IncentiveAlternativeCommand };
export type IncentiveDecisionContext = { strategyId: string; version: number; proposalHash: string; current: boolean;
  alternativeAvailable?: boolean; revisionScope?: "strategy"; expectedRecommendationHash?: string; refreshToken: unknown; disabled: boolean };

/** Keyed by merchant/strategy/version by the parent. A lost reply retries the
 * same command, and the current projection always wins over a historical receipt. */
export function StrategyIncentiveDecision({ context: c, approvalDisplayValid, benefitLabel = "desconto", approvalSummary }: {
  context: IncentiveDecisionContext; approvalDisplayValid: boolean; benefitLabel?: IncentiveBenefitLabel; approvalSummary?: string;
}) {
  const statuses: Record<string, string> = { approved_awaiting_activation: `Proposta de ${benefitLabel} aprovada. O teste ainda não foi iniciado.`,
    rejected: `Proposta de ${benefitLabel} recusada.`, withdrawn: `A aprovação do ${benefitLabel} foi cancelada.`,
    approval_invalidated: "As condições da proposta mudaram. A aprovação anterior não permite iniciar este teste." };
  const verbs = { approve: `Aprovar proposta de ${benefitLabel}`, reject: `Recusar proposta de ${benefitLabel}`, withdraw: `Cancelar aprovação do ${benefitLabel}` };
  const api = useApi();
  const [review, setReview] = useState<IncentiveReview | null>(null);
  const [busy, setBusy] = useState(false), [readError, setReadError] = useState(""), [actionError, setActionError] = useState("");
  const [confirm, setConfirm] = useState<IncentiveDecision | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [alternative, setAlternative] = useState(false), [feedback, setFeedback] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(false), locked = useRef(false), generation = useRef(0);
  const read = useCallback(async () => {
    const value = await api.getIncentiveReview(c.strategyId);
    const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    const validReceipt = (row: IncentiveReview["decision"]) => !!row && typeof row === "object"
      && row.strategy_id === c.strategyId && Number.isSafeInteger(row.version) && row.version > 0
      && hash(row.proposal_hash) && hash(row.recommendation_hash) && typeof row.review_id === "string" && !!row.review_id
      && ["approve", "reject", "withdraw"].includes(row.kind) && row.scope === "incentive_recommendation_only" && row.effect === "decision_recorded"
      && row.status === (row.kind === "approve" ? "approved_awaiting_activation" : row.kind === "reject" ? "rejected" : "withdrawn")
      && Number.isFinite(Date.parse(row.reviewed_at)) && Number.isFinite(Date.parse(row.approval_expires_at));
    if (value.strategy_id !== c.strategyId || !Array.isArray(value.history) || !Array.isArray(value.approval_blockers)
      || !["unavailable", "scheduled", "active", "suspended", "ended", "withdrawn"].includes(value.execution_status) || !Number.isSafeInteger(value.version) || !hash(value.proposal_hash)
      || !value.history.every(validReceipt) || (value.decision !== null && (!validReceipt(value.decision)
        || value.decision.version !== value.version || value.decision.proposal_hash !== value.proposal_hash))
      || typeof value.approval_available !== "boolean" || typeof value.rejection_available !== "boolean"
      || typeof value.withdrawal_available !== "boolean") throw new Error("Invalid incentive review");
    if (c.expectedRecommendationHash && value.version === c.version && value.proposal_hash === c.proposalHash
      && value.recommendation_hash !== c.expectedRecommendationHash) throw new Error("Incentive selection changed");
    return value;
  }, [api, c.strategyId, c.version, c.proposalHash, c.expectedRecommendationHash]);
  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    const seq = generation.current;
    try { const value = await read(); if (alive.current && seq === generation.current) { setReview(value); setReadError(""); } }
    catch { if (alive.current && seq === generation.current) setReadError(`Não foi possível conferir a decisão sobre o ${benefitLabel}. Atualize antes de decidir.`); }
    finally { if (alive.current && seq === generation.current) { locked.current = false; setBusy(false); } }
  }, [read, benefitLabel]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; locked.current = false; ++generation.current; }; }, []);
  useEffect(() => { void load(); }, [load, c.refreshToken]);
  const current = !!review && review.version === c.version && review.proposal_hash === c.proposalHash && c.current;
  const historical = review?.history.find(row => row.version === c.version && row.proposal_hash === c.proposalHash);
  const decision = current ? review.decision : historical;
  const state = current ? review.status : historical?.status;
  const disabled = busy || c.disabled || !!readError || !!pending;
  const approvalAvailable = approvalDisplayValid && current && review.approval_available && typeof review.recommendation_hash === "string"
    && /^[a-f0-9]{64}$/.test(review.recommendation_hash);
  const available = (kind: IncentiveDecision) => kind === "approve" ? approvalAvailable
    : kind === "reject" ? current && review.rejection_available : decision?.kind === "approve" && (!current || review.withdrawal_available);

  const send = async (command: Pending) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setActionError(""); setPending(command);
    const seq = generation.current;
    const active = () => alive.current && seq === generation.current;
    try {
      if (command.kind === "alternative") {
        const receipt = c.revisionScope === "strategy" ? await api.decideStrategy(c.strategyId, "revision", command.input)
          : await api.requestIncentiveAlternative(c.strategyId, command.input);
        if (receipt.strategy_id !== c.strategyId || receipt.version !== command.input.version
          || receipt.proposal_hash !== command.input.proposal_hash || receipt.status !== "revision_requested"
          || (c.revisionScope !== "strategy" && (!("revision_scope" in receipt) || receipt.revision_scope !== "incentive")) || !receipt.action_id) throw new Error("Invalid alternative receipt");
      } else {
      const receipt = await api.decideIncentive(c.strategyId, command.kind, command.input);
      if (receipt.strategy_id !== c.strategyId || receipt.version !== command.input.version
        || receipt.proposal_hash !== command.input.proposal_hash || receipt.recommendation_hash !== command.input.recommendation_hash
        || receipt.kind !== command.kind || receipt.scope !== "incentive_recommendation_only" || receipt.effect !== "decision_recorded"
        || receipt.status !== (command.kind === "approve" ? "approved_awaiting_activation" : command.kind === "reject" ? "rejected" : "withdrawn")
        || !receipt.review_id || !Number.isFinite(Date.parse(receipt.reviewed_at))) throw new Error("Invalid receipt");
      }
      if (!active()) return;
      setPending(null); setConfirm(null);
      if (command.kind === "alternative") {
        setAlternative(false); setFeedback(""); setNotice(c.revisionScope === "strategy"
          ? "Pedido recebido. A IA avaliará outra estratégia dentro das condições da loja. A nova proposta precisará da sua aprovação."
          : `Pedido recebido. A IA preparará outra sugestão de ${benefitLabel}, que precisará da sua aprovação.`);
      }
      strategyChanged(c.strategyId);
    } catch (error) {
      if (!active()) return;
      const uncertain = decisionMayHaveSucceeded(error);
      setPending(uncertain ? command : null); setConfirm(null);
      setActionError(uncertain ? "A confirmação não chegou. Consulte ou reenvie o mesmo pedido para conferir a decisão, sem duplicá-la."
        : "A decisão não foi aceita. Confira a versão, os limites e o estado atual da proposta.");
    } finally {
      if (active()) {
        try { const value = await read(); if (active()) { setReview(value); setReadError(""); } }
        catch { if (active()) setReadError(`Não foi possível atualizar o estado do ${benefitLabel}. Atualize antes de decidir.`); }
        if (active()) { locked.current = false; setBusy(false); }
      }
    }
  };
  const decide = (kind: IncentiveDecision) => {
    if (disabled || !available(kind)) return;
    const hash = kind === "withdraw" ? decision?.recommendation_hash : review?.recommendation_hash;
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return;
    void send({ kind, input: { version: c.version, proposal_hash: c.proposalHash, recommendation_hash: hash, request_key: createIdempotencyKey() } });
  };
  const executionState = current ? review?.execution_status : "unavailable";
  const executionText = executionState === "active" ? `Teste de ${benefitLabel} em andamento.`
    : executionState === "suspended" ? "Novas ofertas estão suspensas porque as condições do teste mudaram."
    : executionState === "scheduled" ? `Teste de ${benefitLabel} aprovado e agendado.`
    : executionState === "ended" ? "Período de ofertas encerrado. As últimas compras ainda podem entrar nos resultados."
    : executionState === "withdrawn" ? `Teste de ${benefitLabel} interrompido. Novas ofertas estão bloqueadas.` : null;
  const startsTest = current && review.activation_available === true;
  const alternativeAvailable = current && c.alternativeAvailable === true && !!review.recommendation_hash;
  return <div className="strategy-incentive-decision" role="group" aria-label={`Decisão sobre o ${benefitLabel}`}>
    <h3>Sua decisão sobre o {benefitLabel}</h3>
    {c.revisionScope === "strategy" ? <p>Esta aprovação autoriza somente o benefício e os limites apresentados nesta estratégia.</p>
      : <p>Aprovar a comunicação abaixo não autoriza o {benefitLabel}.</p>}
    {(executionText || state && statuses[state]) && <p role="status"><strong>{executionText || statuses[state!]}</strong></p>}
    {decision && <p>Decisão registrada em {date(decision.reviewed_at)}.</p>}
    {current && !decision && !approvalAvailable && !readError && <p>Este teste de {benefitLabel} ainda não está disponível para aprovação.</p>}
    {current && !decision && approvalAvailable && <p>{startsTest
      ? "Ao aprovar, o teste será iniciado por sete dias com os valores sugeridos. Metade dos compradores elegíveis receberá a condição, sempre dentro dos limites da loja."
      : "A aprovação registra sua decisão sobre os valores sugeridos. O teste ainda não começa e nenhum desconto é aplicado."}</p>}
    {current && review.budget === null && <p>Nenhum valor foi reservado para este incentivo.</p>}
    {current && review.budget !== null && <p>O orçamento deste incentivo acompanha as reservas e os descontos confirmados nos resultados abaixo.</p>}
    {!current && review && <p>Você está consultando uma versão anterior. Uma nova aprovação exige a proposta atual.</p>}
    {current && review.approval_blockers.includes("financial_policy_changed") && <p>Os limites financeiros mudaram. Aguarde uma proposta que considere os limites atuais.</p>}
    {current && review.approval_blockers.includes("commercial_modes_disabled") && <p>Esta modalidade ainda não está disponível para sua loja.</p>}
    {readError && <p role="alert" className="strategy-review-error">{readError}</p>}
    {actionError && <p role="alert" className="strategy-review-error">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">Conferindo a decisão sobre o {benefitLabel}…</p>}
    <div className="strategy-review-actions">
      {(["approve", "reject", "withdraw"] as const).filter(kind => available(kind)).map(kind => <button key={kind} type="button"
        className={`zyn-btn ${kind === "approve" ? "zyn-btn--primary" : "zyn-btn--secondary"}`} disabled={disabled} onClick={() => { setAlternative(false); setConfirm(kind); }}>{kind === "approve" && startsTest ? `Aprovar e iniciar teste de ${benefitLabel}` : verbs[kind]}</button>)}
      {alternativeAvailable && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={disabled}
        onClick={() => { setConfirm(null); setAlternative(true); }}>{c.revisionScope === "strategy" ? "Pedir outra estratégia" : `Pedir outra sugestão de ${benefitLabel}`}</button>}
      {readError && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={busy} onClick={() => void load()}>Atualizar decisão do {benefitLabel}</button>}
      {pending && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={busy} onClick={() => void send(pending)}>Confirmar decisão do {benefitLabel}</button>}
    </div>
    {confirm && available(confirm) && !disabled && <div className="strategy-feedback">
      <h3>{confirm === "approve" ? startsTest ? "Iniciar o teste com estes valores?" : "Registrar a aprovação destes valores?" : confirm === "reject" ? `Recusar esta sugestão de ${benefitLabel}?` : `Cancelar esta aprovação de ${benefitLabel}?`}</h3>
      {confirm === "approve" && approvalSummary && <p><strong>{approvalSummary}</strong></p>}
      {confirm === "approve" && <p>Se a estratégia aprovada conceder um desconto em uma venda, ele reduz o valor recebido pela loja. Isso não é uma cobrança da Zyon.</p>}
      <p>{confirm === "approve" ? startsTest
        ? "O orçamento e o desconto ficam limitados à sugestão desta versão. O motor confere as condições a cada compra. Você pode interromper novas ofertas a qualquer momento."
        : "A decisão vale apenas para esta versão e perde validade se as condições mudarem. Nenhum teste será iniciado agora."
        : confirm === "reject" ? c.revisionScope === "strategy" ? "Esta proposta será recusada e não iniciará um teste."
          : `Esta sugestão de ${benefitLabel} será recusada. A decisão sobre a comunicação continua separada.`
        : "Novas reservas serão bloqueadas. Valores já reservados continuarão registrados até sua conclusão."}</p>
      <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--ghost" onClick={() => setConfirm(null)}>Voltar à proposta</button>
        <button type="button" className="zyn-btn zyn-btn--primary" onClick={() => decide(confirm)}>{confirm === "approve" ? startsTest ? `Confirmar início do teste de ${benefitLabel}` : `Registrar aprovação do ${benefitLabel}` : confirm === "reject" ? `Confirmar recusa do ${benefitLabel}` : `Confirmar cancelamento do ${benefitLabel}`}</button></div>
    </div>}
    {alternative && alternativeAvailable && <form className="strategy-feedback" onSubmit={event => {
      event.preventDefault(); if (disabled || !review?.recommendation_hash) return;
      void send({ kind: "alternative", input: { version: c.version, proposal_hash: c.proposalHash,
        recommendation_hash: review.recommendation_hash, request_key: createIdempotencyKey(), ...(feedback.trim() ? { feedback: feedback.trim() } : {}) } });
    }}>
      <label htmlFor="incentive-alternative-feedback">O que você gostaria que a IA considerasse? (opcional)</label>
      <textarea id="incentive-alternative-feedback" maxLength={2000} value={feedback} disabled={disabled} onChange={event => setFeedback(event.target.value)} />
      <p>{c.revisionScope === "strategy" ? "A IA reavalia as opções disponíveis e pode sugerir outro benefício ou uma estratégia de comunicação. Você não precisa definir os valores. A nova proposta exige sua aprovação."
        : "A IA prepara uma opção com desconto e orçamento menores, dentro dos limites da loja. A nova sugestão só pode ser aplicada depois da sua aprovação."}</p>
      <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--ghost" disabled={disabled} onClick={() => setAlternative(false)}>Voltar à proposta</button>
        <button type="submit" className="zyn-btn zyn-btn--primary" disabled={disabled}>Solicitar nova sugestão</button></div>
    </form>}
  </div>;
}
