import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { StrategyReviewModal } from "./StrategyReviewModal.js";
import { StrategyMetricsPanel } from "./StrategyMetricsPanel.js";
import { useStrategyReview } from "./useStrategyReview.js";
import { canReviewVersion, formatReviewDate as date, formatReviewNumber as number, REVISION_STATUSES, STRATEGY_STATUSES, versionExpired } from "./strategy-review-model.js";
import "./strategy-review.css";

function MeasurementDetails({ proposal }: { proposal: StrategyProposal }) {
  const measurement = proposal.experimentReview;
  if (!measurement) return <section className="strategy-detail-section"><h2>Plano de teste</h2>
    <p>Esta versão ainda não inclui os critérios de medição. O teste não pode ser iniciado.</p></section>;
  if (measurement.definition !== "checkout-strategy-experiment-review-v1"
    || measurement.planning.population.definition !== "checkout-first-session-per-buyer-v1"
    || measurement.plan.definitionVersion !== "session-conversion-fixed-horizon-v1") {
    return <section className="strategy-detail-section"><h2>Plano de teste</h2><p>Atualize o dashboard para consultar este formato de plano.</p></section>;
  }
  const { plan } = measurement;
  return <section className="strategy-detail-section" aria-labelledby="strategy-measurement-title">
    <h2 id="strategy-measurement-title">Como o resultado será avaliado</h2>
    <p>O plano divide os participantes em dois grupos: metade mantém a comunicação atual; a outra metade recebe a abordagem sugerida.</p>
    <dl className="strategy-measurement-facts">
      <div><dt>Duração planejada</dt><dd>{plan.durationDays} dias</dd></div>
      <div><dt>Janela para contar a compra</dt><dd>{plan.conversionWindowHours} horas por sessão</dd></div>
      <div><dt>Amostra necessária</dt><dd>{number(plan.minimumSessionsPerArm)} sessões por grupo</dd></div>
      <div><dt>Tráfego estimado no período</dt><dd>{number(plan.trafficEstimate.sessionsPerArm)} sessões por grupo</dd></div>
      <div><dt>Melhora mínima planejada</dt><dd>{number(plan.minimumEffectBps / 100)} pontos percentuais</dd></div>
      <div><dt>Métrica principal</dt><dd>Conversão em pedido aprovado</dd></div>
    </dl>
    {measurement.capacity === "below_planned_sample" && <p className="strategy-review-warning">O tráfego estimado está abaixo da amostra necessária. O teste pode terminar sem evidência suficiente para concluir se houve melhora.</p>}
    <p>O prazo de {plan.durationDays} dias, sozinho, não confirma um resultado. É preciso alcançar a amostra e aguardar a janela de conversão das últimas sessões.</p>
    <details className="strategy-review-details"><summary>Público e base de comparação</summary>
      <div className="strategy-review-details-body">
        <p>Participa a primeira sessão elegível de cada comprador identificado, nesta loja e em reais, durante o período de entrada no teste. O grupo reservado para acompanhar o checkout sem intervenções fica de fora.</p>
        <p>Todas as sessões participantes contam, inclusive sem compra ou conversa com a IA. A abordagem é proposta apenas para a conversa principal; cadastro, validações e respostas de contingência mantêm o comportamento atual.</p>
        {proposal.checkoutBaseline?.contextExit === "checkout-context-exit-v1" && <p>Se uma sessão encontrar cupons, ofertas, personalização ou outra condição ainda não atendida pelo teste, seguirá pelo checkout habitual até o fim. Isso vale para os dois grupos. A sessão e suas compras continuam na comparação.</p>}
        {proposal.checkoutBaseline?.suppressionRecovery === "checkout-suppression-recovery-v1" && <p>Se uma resposta do teste for bloqueada antes de ser publicada, a conversa poderá continuar pelo checkout habitual após a confirmação automática. A resposta não será reenviada e os custos já registrados serão preservados.</p>}
        <p>A compra precisa ser aprovada em reais e ligada à mesma sessão dentro de {plan.conversionWindowHours} horas.</p>
        <p>Planejamento baseado em {number(plan.baseline.sessions)} sessões e {number(plan.baseline.conversions)} conversões, de {date(plan.baseline.windowStart)} a {date(plan.baseline.windowEnd)}. Dados registrados em {date(measurement.planning.capturedAt)}.</p>
        <p>Confiança planejada: {number(plan.confidence * 100)}%. Poder estatístico: {number(plan.planningPower * 100)}%. Esses dados históricos dimensionam o teste e não comprovam o efeito da estratégia.</p>
      </div>
    </details>
  </section>;
}

export function StrategyReviewPage({ strategyId, merchantId, onBack }: { strategyId: string; merchantId: string; onBack: () => void }) {
  const vm = useStrategyReview(strategyId, merchantId);
  const [feedback, setFeedback] = useState("");
  const [form, setForm] = useState<"approve" | "revision" | "reject" | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const version = vm.review?.versions.find(v => v.version === vm.selectedVersion);
  const proposal = version?.proposal;
  const current = vm.review && version && vm.review.currentVersion === version.version;
  const expired = !!(vm.review && version && versionExpired(vm.review, version));
  const canDecide = !!(vm.review && version && canReviewVersion(vm.review, version) && !vm.busy && !vm.readError && !vm.pending);
  const revisionAvailable = canDecide && !expired && vm.review?.revision_available;
  const approvalAvailable = canDecide && !expired && vm.review?.approval_available && vm.review.activation_available;
  return <div className="page-container strategy-page">
    <button type="button" className="zyn-btn zyn-btn--ghost strategy-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Voltar às sugestões</button>
    <header className="page-head"><div><span className="eyebrow">Otimização de Checkout</span>
      <h1 ref={title} tabIndex={-1}>Revisar estratégia</h1><p className="page-lead">Confira a proposta da IA e decida o próximo passo.</p></div></header>
    {vm.loading && <div className="strategy-loading" role="status">Carregando a proposta e o histórico…</div>}
    {vm.readError && <div className="strategy-review-error" role="alert"><p>{vm.readError}</p>
      {vm.review && <p>Os dados abaixo podem estar desatualizados. Atualize antes de decidir.</p>}
      <button type="button" className="zyn-btn zyn-btn--secondary" onClick={() => void vm.refresh()}>Tentar novamente</button></div>}
    {vm.legacy && <StrategyReviewModal hypothesisId={strategyId} merchantId={merchantId} onClose={onBack} approvalDisabled={vm.legacy.weekly} />}
    {vm.review && version && proposal && <>
      <div className="strategy-version-bar">
        <label htmlFor="strategy-version">Versão da proposta
          <select id="strategy-version" value={version.version} disabled={vm.busy || !!vm.pending}
            onChange={event => { vm.selectVersion(Number(event.target.value)); setForm(null); }}>
            {vm.review.versions.map(v => <option key={v.version} value={v.version}>Versão {v.version}{v.version === vm.review!.currentVersion ? " (atual)" : " (histórico)"}</option>)}
          </select>
        </label>
        <div><strong>{STRATEGY_STATUSES[vm.review.status] ?? "Estado indisponível"}</strong><span>Validade: {date(version.expiresAt)}</span></div>
        <button type="button" className="zyn-btn zyn-btn--ghost" disabled={vm.busy} onClick={() => void vm.refresh()}><RefreshCw size={16} aria-hidden="true" /> Atualizar</button>
      </div>
      {!current && <div className="strategy-review-warning" role="status">Você está vendo uma versão anterior. A versão {vm.review.currentVersion} está disponível.
        <button type="button" className="zyn-btn zyn-btn--secondary" disabled={vm.busy || !!vm.pending} onClick={() => { vm.selectVersion(vm.review!.currentVersion); setForm(null); }}>Ver versão atual</button></div>}
      {expired && current && <p className="strategy-review-warning" role="status">Esta proposta venceu. Você ainda pode recusá-la. Uma nova proposta depende da próxima análise da loja.</p>}
      <article className="strategy-review strategy-review-document" aria-label={`Proposta da estratégia, versão ${version.version}`}>
        <section className="strategy-detail-section"><h2>{proposal.recommendation.hypothesis_text}</h2>
          <p>{proposal.recommendation.reasoning}</p>
          <p className="strategy-review-note">Impacto estimado pela IA: {number(proposal.recommendation.expected_lift_percent)}%. Ainda não medido; não é uma garantia de resultado.</p>
        </section>
        <section className="strategy-detail-section"><h2>O que a IA propõe</h2>
          <p>{proposal.recommendation.template.description}</p>
          <div className="strategy-communication"><h3>Abordagem sugerida</h3><p className="strategy-review-copy">{proposal.recommendation.template.variant_b.system_prompt}</p></div>
          <h3>Comparação com a comunicação atual</h3><p>{proposal.baselineStatus === "primary_chat_contract_captured"
            ? "A proposta preserva uma versão da comunicação atual para comparação e acrescenta a abordagem sugerida à conversa principal."
            : "Esta versão ainda precisa de uma referência verificável da comunicação atual antes de iniciar um teste."}</p>
        </section>
        <details className="strategy-review-details"><summary>Dados que embasaram a sugestão</summary><div className="strategy-review-details-body">
          <p>Período: {date(proposal.observation.observation_window_start)} a {date(proposal.observation.observation_window_end)}.</p>
          <p>{number(proposal.observation.data_quality?.mature_sessions ?? proposal.observation.funnel.total_sessions)} sessões avaliadas. Conversão observada: {proposal.observation.funnel.conversion_rate == null ? "indisponível" : `${number(proposal.observation.funnel.conversion_rate * 100)}%`}.</p>
          {!!proposal.observation.data_quality?.missing_metrics?.length && <p>Algumas métricas não estavam disponíveis nesta análise. Elas não foram tratadas como resultados comprovados.</p>}
          <p>O desempenho histórico da loja não mede o resultado desta proposta.</p>
        </div></details>
        <section className="strategy-detail-section"><h2>Limites comerciais considerados</h2>
          <dl className="strategy-measurement-facts"><div><dt>Margem mínima configurada</dt><dd>{number(proposal.rules.minimumMarginPercent)}%</dd></div>
            <div><dt>Teto de desconto configurado</dt><dd>{number(proposal.rules.maxDiscountPercent)}%</dd></div></dl>
          <p>Esta proposta altera a comunicação. Não cria cupom, desconto ou frete grátis. Os limites acima são os registrados nesta versão; não autorizam uma oferta nem comprovam sua margem.</p>
        </section>
        <MeasurementDetails proposal={proposal} />
        <StrategyMetricsPanel key={`${merchantId}:${strategyId}:${version.version}:${vm.review.status}`} strategyId={strategyId} version={version.version} proposalHash={version.proposalHash} />
      </article>
      <section className="strategy-decision" aria-labelledby="strategy-decision-title">
        <h2 id="strategy-decision-title">Sua decisão</h2>
        {vm.review.status === "pending_review" && !vm.review.approval_available && <div className="strategy-activation-note" id="strategy-activation-note"><strong>Aprovação indisponível no momento</strong>
          <p>Esta proposta ainda não reúne as condições para iniciar o teste nesta loja.</p>
          {vm.review.activation_blockers.includes("reviewed_measurement_plan_required") && <p>Também falta incluir o plano de medição na proposta.</p>}
          {vm.review.activation_blockers.includes("versioned_checkout_contract_required") && <p>Também falta registrar a comunicação atual do checkout para comparação.</p>}
          {vm.review.activation_blockers.includes("checkout_baseline_changed") && <p>O checkout mudou desde a análise. É necessário revisar a proposta antes de iniciar.</p>}
          {vm.review.activation_blockers.includes("experiment_already_active") && <p>Já existe um teste ativo ou pausado nesta loja.</p>}
        </div>}
        {current && vm.review.status === "active" && <p role="status">Esta versão está em teste. Os resultados acima serão atualizados conforme as sessões forem avaliadas.</p>}
        <div className="strategy-review-actions strategy-decision-actions">
          <button type="button" className={`zyn-btn ${approvalAvailable && !form ? "zyn-btn--primary" : "zyn-btn--secondary"}`} disabled={!approvalAvailable}
            aria-describedby={!vm.review.approval_available && vm.review.status === "pending_review" ? "strategy-activation-note" : undefined} onClick={() => setForm("approve")}>Aprovar estratégia</button>
          <button type="button" className={`zyn-btn ${form || approvalAvailable ? "zyn-btn--secondary" : "zyn-btn--primary"}`} disabled={!revisionAvailable} onClick={() => setForm("revision")}>Pedir alternativa</button>
          <button type="button" className="zyn-btn zyn-btn--ghost" disabled={!canDecide} onClick={() => setForm("reject")}>Recusar estratégia</button>
        </div>
        {current && vm.review.status === "pending_review" && !expired && !vm.review.revision_available && <p>Novas alternativas estão indisponíveis neste ciclo. Os pedidos dependem da configuração e dos limites de revisão da loja.</p>}
        {vm.review.status === "revision_pending" && <p role="status">A IA recebeu seu pedido de alternativa. A revisão respeita o orçamento e a disponibilidade do ciclo. Nenhuma mudança foi aplicada ao checkout.</p>}
        {form === "approve" && approvalAvailable && <form className="strategy-feedback" onSubmit={event => { event.preventDefault(); void vm.decide("approve", version, ""); }}>
          <h3>Iniciar o teste da versão {version.version}?</h3>
          <p>A abordagem de comunicação será testada por {proposal.experimentReview?.plan.durationDays} dias. Metade dos participantes mantém a comunicação atual. A IA acompanha as métricas; o resultado pode ser inconclusivo.</p>
          <p>A aprovação vale para esta versão. Uma nova proposta precisa de outra aprovação.</p>
          <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button type="submit" className="zyn-btn zyn-btn--primary">Aprovar e iniciar teste</button></div>
        </form>}
        {form && form !== "approve" && canDecide && (form === "reject" || revisionAvailable) && <form className="strategy-feedback" onSubmit={event => { event.preventDefault(); void vm.decide(form, version, feedback); }}>
          <label htmlFor="strategy-feedback">{form === "revision" ? "O que a IA deve considerar na alternativa?" : "Motivo da recusa (opcional)"}</label>
          <p id="strategy-feedback-help">{form === "revision" ? "Descreva o objetivo ou a preferência. A IA prepara uma nova proposta para você revisar, mantendo os limites da loja. Evite dados pessoais de compradores." : "A recusa encerra esta proposta e não altera as regras ativas da loja."}</p>
          <textarea id="strategy-feedback" aria-describedby="strategy-feedback-help" maxLength={2000} rows={4} value={feedback}
            required={form === "revision"} onChange={event => setFeedback(event.target.value)} />
          <span className="strategy-review-note">{feedback.length}/2.000 caracteres</span>
          <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button type="submit" className="zyn-btn zyn-btn--primary" disabled={form === "revision" && !feedback.trim()}>{form === "revision" ? "Enviar pedido de alternativa" : "Confirmar recusa"}</button></div>
        </form>}
        {vm.busy && <p role="status">Enviando decisão…</p>}
        {vm.actionError && <div role="alert" className="strategy-review-error"><p>{vm.actionError}</p>
          {vm.pending && <button type="button" className="zyn-btn zyn-btn--secondary" disabled={vm.busy} onClick={() => void vm.retry()}>Confirmar envio</button>}</div>}
        {vm.message && <p role="status" className="strategy-review-success">{vm.message}</p>}
      </section>
      <section className="strategy-history" aria-labelledby="strategy-history-title"><h2 id="strategy-history-title">Histórico de propostas e decisões</h2>
        <ol>{vm.review.versions.map(v => <li key={`version-${v.version}`}><strong>Versão {v.version} criada</strong><span>{date(v.createdAt)}</span>
          <p>{v.proposal.recommendation.hypothesis_text}</p><button type="button" className="zyn-btn zyn-btn--ghost" disabled={vm.busy || !!vm.pending || version.version === v.version} onClick={() => { vm.selectVersion(v.version); setForm(null); title.current?.focus(); }}>Consultar versão {v.version}</button></li>)}</ol>
        {vm.review.actions.length ? <ol>{vm.review.actions.map(action => <li key={action.id}>
          <strong>{action.kind === "revision" ? "Alternativa solicitada" : action.kind === "reject" ? "Estratégia recusada" : action.kind === "approve" ? "Estratégia aprovada" : "Decisão registrada"} · versão {action.version}</strong><span>{date(action.createdAt)}</span>
          {action.feedback && <p className="strategy-feedback-history">{action.feedback}</p>}
          {action.revision && <p>{REVISION_STATUSES[action.revision.status] ?? "Aguardando atualização"}{action.revision.reason === "proposal_requires_new_analysis" ? ". A proposta precisa de uma nova análise." : action.revision.reason === "proposal_expired" ? ". A validade da proposta terminou." : ""}</p>}
        </li>)}</ol> : <p>Nenhuma decisão registrada. Abrir os detalhes não aprova nem recusa a proposta.</p>}
      </section>
    </>}
  </div>;
}
