import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import { DashboardHttpError } from "../../api/http/error.js";
import type { StrategyReview, StrategyReviewCommand, StrategyVersion } from "../../api/endpoints/strategy-review.js";
import { canReviewVersion, decisionMayHaveSucceeded, reviewErrorCode, reviewErrorMessage, versionExpired } from "./strategy-review-model.js";
import { strategyChanged, STRATEGY_CHANGED_EVENT } from "./strategy-review.js";
import { strategyActionMode } from "./incentive-recommendation-model.js";

type PendingDecision = { kind: "approve" | "reject" | "revision"; input: StrategyReviewCommand };

export function useStrategyReview(id: string, merchantId: string) {
  const api = useApi();
  const [review, setReview] = useState<StrategyReview | null>(null);
  const [selectedVersion, selectVersion] = useState<number | null>(null);
  const [legacy, setLegacy] = useState<null | { weekly: boolean }>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const alive = useRef(false);
  const locked = useRef(false);
  const refreshQueued = useRef(false);

  const read = useCallback(async () => {
    try {
      const data = await api.getStrategyReview(id);
      if (data.id !== id || data.merchantId !== merchantId || !data.versions?.some(v => v.version === data.currentVersion)) {
        throw new Error("Invalid strategy review response");
      }
      if (alive.current) { setReview(data); setReadError(""); selectVersion(previous => previous ?? data.currentVersion); }
    } catch (error) {
      if (!alive.current) return;
      // Only the explicit domain 404 permits the old review path. No fallback on
      // denied access, network errors, or unsupported deployments.
      if (error instanceof DashboardHttpError && error.status === 404 && reviewErrorCode(error) === "STRATEGY_NOT_FOUND") {
        try {
          await api.getHypothesis(id);
          const status = await api.getAnalysisStatus();
          if (alive.current) setLegacy({ weekly: status.mode === "weekly" });
        } catch (fallbackError) { if (alive.current) setReadError(reviewErrorMessage(fallbackError)); }
      } else setReadError(reviewErrorMessage(error));
    }
  }, [api, id, merchantId]);

  const refresh = useCallback(async () => {
    if (locked.current) { refreshQueued.current = true; return; }
    locked.current = true;
    try {
      do { refreshQueued.current = false; await read(); } while (alive.current && refreshQueued.current);
    } finally { locked.current = false; if (alive.current) setLoading(false); }
  }, [read]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    const focus = () => { void refresh(); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ hypothesisId: string }>).detail?.hypothesisId === id) void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener(STRATEGY_CHANGED_EVENT, changed);
    return () => { alive.current = false; window.clearInterval(timer); window.removeEventListener("focus", focus);
      window.removeEventListener(STRATEGY_CHANGED_EVENT, changed); };
  }, [refresh, id]);

  const send = async (command: PendingDecision) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setActionError(""); setMessage("");
    try {
      const receipt = await api.decideStrategy(id, command.kind, command.input);
      if (receipt.strategy_id !== id || receipt.version !== command.input.version
        || receipt.proposal_hash !== command.input.proposal_hash
        || receipt.status !== (command.kind === "approve" ? "active" : command.kind === "reject" ? "rejected" : "revision_requested")
        || (command.kind === "approve" && (!receipt.execution_id || !receipt.experiment_id
          || !Number.isFinite(Date.parse(receipt.started_at ?? "")) || !Number.isFinite(Date.parse(receipt.ends_at ?? ""))))) {
        throw new Error("Invalid decision receipt");
      }
      if (!alive.current) return;
      setPending(null);
      setMessage(command.kind === "approve" ? "Aprovação confirmada. O teste desta versão foi iniciado. Acompanhe o estado e os resultados acima."
        : command.kind === "reject" ? "Estratégia recusada. Nenhuma alteração foi aplicada."
        : "Pedido recebido. A IA preparará uma alternativa conforme a disponibilidade e os limites do ciclo. Você receberá uma notificação.");
      strategyChanged(id);
    } catch (error) {
      if (!alive.current) return;
      const uncertain = decisionMayHaveSucceeded(error);
      setPending(uncertain ? command : null);
      setActionError(uncertain ? "Não recebemos a confirmação. O pedido pode ter sido registrado. Use Confirmar envio para consultar ou reenviar o mesmo pedido, sem duplicá-lo."
        : reviewErrorMessage(error));
    } finally {
      if (alive.current) { await read(); setBusy(false); }
      locked.current = false;
      if (alive.current && refreshQueued.current) void refresh();
    }
  };
  const decide = async (kind: PendingDecision["kind"], version: StrategyVersion, feedback: string) => {
    if (!review || pending || readError || !canReviewVersion(review, version) || locked.current) return;
    const actionMode = strategyActionMode(version.proposal);
    if (actionMode === "unsupported") return;
    if (kind === "revision" && (!review.revision_available || versionExpired(review, version) || actionMode === "legacy" && !feedback.trim())) return;
    if (kind === "approve" && (actionMode === "commercial" || !review.approval_available || !review.activation_available || versionExpired(review, version))) return;
    await send({ kind, input: { version: version.version, proposal_hash: version.proposalHash,
      request_key: createIdempotencyKey(), ...(feedback.trim() ? { feedback: feedback.trim() } : {}) } });
  };
  return { review, selectedVersion, selectVersion, legacy, loading, busy, readError, actionError, message,
    pending, refresh, decide, retry: () => pending ? send(pending) : Promise.resolve() };
}
