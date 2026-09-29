import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import type { IncentiveDecision, IncentiveReview, IncentiveReviewCommand } from "../../api/endpoints/incentive-review.js";
import { decisionMayHaveSucceeded, formatReviewDate as date } from "./strategy-review-model.js";
import { strategyChanged } from "./strategy-review.js";

type Pending = { kind: IncentiveDecision; input: IncentiveReviewCommand };
export type IncentiveDecisionContext = { strategyId: string; version: number; proposalHash: string; current: boolean; refreshToken: unknown; disabled: boolean };
const statuses: Record<string, string> = { approved_awaiting_activation: "Proposta de desconto aprovada. O teste ainda não foi iniciado.",
  rejected: "Proposta de desconto recusada.", withdrawn: "A aprovação do desconto foi cancelada.",
  approval_invalidated: "As condições da proposta mudaram. A aprovação anterior não permite iniciar este teste." };
const verbs = { approve: "Aprovar proposta de desconto", reject: "Recusar proposta de desconto", withdraw: "Cancelar aprovação do desconto" };

/** Keyed by merchant/strategy/version by the parent. A lost reply retries the
 * same command, and the current projection always wins over a historical receipt. */
export function StrategyIncentiveDecision({ context: c, approvalDisplayValid }: { context: IncentiveDecisionContext; approvalDisplayValid: boolean }) {
  const api = useApi();
  const [review, setReview] = useState<IncentiveReview | null>(null);
  const [busy, setBusy] = useState(false), [readError, setReadError] = useState(""), [actionError, setActionError] = useState("");
  const [confirm, setConfirm] = useState<IncentiveDecision | null>(null), [pending, setPending] = useState<Pending | null>(null);
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
      || value.execution_status !== "unavailable" || !Number.isSafeInteger(value.version) || !hash(value.proposal_hash)
      || !value.history.every(validReceipt) || (value.decision !== null && (!validReceipt(value.decision)
        || value.decision.version !== value.version || value.decision.proposal_hash !== value.proposal_hash))
      || typeof value.approval_available !== "boolean" || typeof value.rejection_available !== "boolean"
      || typeof value.withdrawal_available !== "boolean") throw new Error("Invalid incentive review");
    return value;
  }, [api, c.strategyId]);
  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    const seq = generation.current;
    try { const value = await read(); if (alive.current && seq === generation.current) { setReview(value); setReadError(""); } }
    catch { if (alive.current && seq === generation.current) setReadError("Não foi possível conferir a decisão sobre o desconto. Atualize antes de decidir."); }
    finally { if (alive.current && seq === generation.current) { locked.current = false; setBusy(false); } }
  }, [read]);
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
      const receipt = await api.decideIncentive(c.strategyId, command.kind, command.input);
      if (receipt.strategy_id !== c.strategyId || receipt.version !== command.input.version
        || receipt.proposal_hash !== command.input.proposal_hash || receipt.recommendation_hash !== command.input.recommendation_hash
        || receipt.kind !== command.kind || receipt.scope !== "incentive_recommendation_only" || receipt.effect !== "decision_recorded"
        || receipt.status !== (command.kind === "approve" ? "approved_awaiting_activation" : command.kind === "reject" ? "rejected" : "withdrawn")
        || !receipt.review_id || !Number.isFinite(Date.parse(receipt.reviewed_at))) throw new Error("Invalid receipt");
      if (!active()) return;
      setPending(null); setConfirm(null);
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
        catch { if (active()) setReadError("Não foi possível atualizar o estado do desconto. Atualize antes de decidir."); }
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
  return <div className="strategy-incentive-decision" role="group" aria-label="Decisão sobre o desconto">
    <h3>Sua decisão sobre o desconto</h3>
    <p>Aprovar a comunicação abaixo não autoriza o desconto.</p>
    {state && statuses[state] && <p role="status"><strong>{statuses[state]}</strong></p>}
    {decision && <p>Decisão registrada em {date(decision.reviewed_at)}.</p>}
    {current && !decision && !approvalAvailable && !readError && <p>Este teste de desconto ainda não está disponível para aprovação.</p>}
    {current && !decision && approvalAvailable && <p>A aprovação registra sua decisão sobre os valores sugeridos. O teste ainda não começa e nenhum desconto é aplicado.</p>}
    {current && review.budget === null && <p>Nenhum valor foi reservado para este incentivo.</p>}
    {current && review.budget !== null && <p>Existe um orçamento registrado para esta proposta. Isso não confirma o início do teste.</p>}
    {!current && review && <p>Você está consultando uma versão anterior. Uma nova aprovação exige a proposta atual.</p>}
    {current && review.approval_blockers.includes("financial_policy_changed") && <p>Os limites financeiros mudaram. Aguarde uma proposta que considere os limites atuais.</p>}
    {readError && <p role="alert" className="strategy-review-error">{readError}</p>}
    {actionError && <p role="alert" className="strategy-review-error">{actionError}</p>}
    {busy && <p role="status">Conferindo a decisão sobre o desconto…</p>}
    <div className="strategy-review-actions">
      {(["approve", "reject", "withdraw"] as const).filter(kind => available(kind)).map(kind => <button key={kind} type="button"
        className={`zyn-btn ${kind === "approve" ? "zyn-btn--primary" : "zyn-btn--secondary"}`} disabled={disabled} onClick={() => setConfirm(kind)}>{verbs[kind]}</button>)}
      {readError && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={busy} onClick={() => void load()}>Atualizar decisão do desconto</button>}
      {pending && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={busy} onClick={() => void send(pending)}>Confirmar decisão do desconto</button>}
    </div>
    {confirm && available(confirm) && !disabled && <div className="strategy-feedback">
      <h3>{confirm === "approve" ? "Registrar a aprovação destes valores?" : confirm === "reject" ? "Recusar esta sugestão de desconto?" : "Cancelar esta aprovação de desconto?"}</h3>
      <p>{confirm === "approve" ? "A decisão vale apenas para esta versão e perde validade se as condições mudarem. Nenhum teste será iniciado agora."
        : confirm === "reject" ? "Esta sugestão de desconto será recusada. A decisão sobre a comunicação continua separada."
        : "Novas reservas serão bloqueadas. Valores já reservados continuarão registrados até sua conclusão."}</p>
      <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--ghost" onClick={() => setConfirm(null)}>Voltar à proposta</button>
        <button type="button" className="zyn-btn zyn-btn--primary" onClick={() => decide(confirm)}>{confirm === "approve" ? "Registrar aprovação do desconto" : confirm === "reject" ? "Confirmar recusa do desconto" : "Confirmar cancelamento do desconto"}</button></div>
    </div>}
  </div>;
}
