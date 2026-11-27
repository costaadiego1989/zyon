import React, { useEffect, useRef, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { Modal } from "../../../components/Modal.js";
import { Button } from "../../../components/Button.js";
import type { ExperimentActivationReview as Review } from "../../../api/endpoints/experiments.js";
import type { Experiment } from "../types.js";
import { DashboardHttpError } from "../../../api/http/error.js";

const reasons: Record<string, string> = {
  EXPERIMENT_MEASUREMENT_PLAN_REQUIRED: "Prepare o plano de medição antes de aprovar este teste.",
  EXPERIMENT_INSUFFICIENT_PLANNING_BASELINE: "Ainda não há histórico maduro suficiente para planejar este teste. Aguarde mais sessões e compras concluídas.",
  EXPERIMENT_MEASUREMENT_NOT_CONFIGURED: "A plataforma precisa configurar a duração e a janela de medição deste teste.",
  EXPERIMENT_INVALID_MEASUREMENT_CONFIG: "A configuração de medição precisa ser corrigida pela plataforma.",
  EXPERIMENT_WEEKLY_ENROLLMENT_REQUIRED: "A preparação do plano requer a configuração de acompanhamento da loja.",
  EXPERIMENT_REVIEW_STALE: "O teste mudou desde sua revisão. Recarregue e confira a nova versão antes de aprovar.",
  EXPERIMENT_ALREADY_APPROVED: "Esta versão já recebeu outra aprovação. Recarregue a lista para consultar o estado atual.",
  EXPERIMENT_NOT_DRAFT: "Este teste já saiu do estado de rascunho. Recarregue a lista para consultar o estado atual.",
  EXPERIMENT_HUMAN_APPROVAL_REQUIRED: "A aprovação exige um proprietário ou administrador com acesso ativo à loja.",
  EXPERIMENT_MEASUREMENT_PLAN_CORRUPT: "O plano não corresponde à versão atual. A plataforma precisa revisar este teste.",
  EXPERIMENT_COMMUNICATION_VARIANTS_REQUIRED: "Revise as instruções e a divisão do público. Esta aprovação permite somente variantes de comunicação, sem novas regras financeiras.",
  MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT: "Já existe um teste em execução. Conclua-o antes de iniciar outro.",
};
const errorCode = (error: unknown): string => {
  if (error instanceof DashboardHttpError) {
    try {
      const body = JSON.parse(error.responseBody);
      const code = body?.message ?? body?.code;
      return typeof code === "string" && Object.hasOwn(reasons, code) ? code : "";
    } catch { return ""; }
  }
  return error instanceof Error && Object.hasOwn(reasons, error.message) ? error.message : "";
};
const explain = (error: unknown) => reasons[errorCode(error)] ?? "Não foi possível concluir a operação. Tente novamente.";

export function ExperimentActivationReview({ experimentId, onClose, onActivated }: {
  experimentId: string; onClose: () => void; onActivated: (experiment: Experiment) => void;
}) {
  const api = useApi();
  const [review, setReview] = useState<Review | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false), requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setReview(null); setAcknowledged(false);
    void api.getExperimentActivationReview(experimentId).then(value => {
      if (active) { setReview(value); requestKey.current = crypto.randomUUID(); }
    }).catch(reason => { if (active) setError(explain(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, experimentId, attempt]);

  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setAcknowledged(false);
    try { setReview(await api.prepareExperimentActivation(experimentId)); requestKey.current = crypto.randomUUID(); }
    catch (reason) { setError(explain(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function approve() {
    if (inFlight.current || !review?.canApprove || !acknowledged) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await api.approveExperimentActivation(experimentId, {
        expected_review_hash: review.reviewHash, request_key: requestKey.current, acknowledged: true,
      });
      if (!result.experiment) throw Error("missing_confirmed_experiment");
      onActivated(result.experiment); onClose();
    } catch (reason) {
      setError(explain(reason));
      if (/^EXPERIMENT_(REVIEW_STALE|ALREADY_APPROVED|NOT_DRAFT)$/.test(errorCode(reason))) {
        setReview(null); setAcknowledged(false);
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <Modal isOpen title="Revisar e aprovar teste" size="lg" onClose={() => { if (!inFlight.current) onClose(); }}
    subtitle="Confira as instruções que serão usadas com os compradores."
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
      <Button disabled={loading || busy || !review?.canApprove || !acknowledged} loading={busy} onClick={approve}>Aprovar e iniciar teste</Button></>}>
    {loading && <p role="status">Carregando revisão…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !review && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Recarregar revisão</Button>}
    {review && <>
      <h3>{review.name}</h3>
      {review.variants.map(variant => <section key={variant.id} style={{ marginBlock: 16 }} aria-label={variant.name}>
        <h4>{variant.name} · {variant.isControl ? "Referência" : "Desafiante"} · {variant.weight}% do público</h4>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{variant.systemPrompt}</p>
      </section>)}
      <p>As duas abordagens usam as instruções exibidas acima. A aprovação não altera preços, descontos ou regras financeiras e não promove uma variante automaticamente.</p>
      {review.measurementPlan ? <section aria-label="Plano de medição">
        <p>Duração: {review.measurementPlan.durationDays} dias. Janela de conversão: {review.measurementPlan.conversionWindowHours} horas.</p>
        <p>Amostra planejada: {review.measurementPlan.minimumSessionsPerArm} sessões por variante. Histórico: {review.measurementPlan.baseline.sessions} sessões e {review.measurementPlan.baseline.conversions} conversões.</p>
        {!review.measurementPlan.trafficEstimate.reachesPlannedSample && <p>O tráfego estimado pode ser insuficiente para atingir a amostra. O resultado pode ser inconclusivo.</p>}
      </section> : !review.measurementRequired && <p>Este teste não tem um plano de medição registrado. Avalie os resultados como exploratórios.</p>}
      {review.blockers.map(code => <p role="alert" key={code}>{reasons[code] ?? "Este teste precisa ser revisado antes da ativação."}</p>)}
      {review.blockers.includes("EXPERIMENT_MEASUREMENT_PLAN_REQUIRED") && <Button variant="outline" disabled={busy} onClick={prepare}>Preparar plano de medição</Button>}
      <p>Versão em revisão: <code>{review.reviewHash.slice(0, 12)}</code></p>
      <label><input type="checkbox" checked={acknowledged} disabled={busy || !review.canApprove} onChange={event => setAcknowledged(event.target.checked)} /> Revisei as instruções, a divisão do público e as condições deste teste.</label>
    </>}
  </Modal>;
}
