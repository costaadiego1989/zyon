import React, { useEffect, useRef, useState } from "react";
import { Check, FlaskConical } from "lucide-react";
import { Modal } from "../../components/Modal.js";
import { PageLoader } from "../../components/PageLoader.js";
import { showToast } from "../../components/Toast.js";
import { useApi } from "../../hooks/useApi.js";
import type { Hypothesis, ApproveMode, HypothesisDiscountRule } from "../../api/endpoints/revenue-manager.js";
import { strategyChanged } from "./strategy-review.js";
import "./strategy-review.css";

const RISK = { low: "Baixo", medium: "Médio", high: "Alto" };
const FIELDS: Record<string, string> = { cart_total: "Valor do carrinho", cart_item_count: "Quantidade de itens",
  buyer_type: "Perfil do comprador", category_in_cart: "Categoria no carrinho", coupon_applied: "Cupom aplicado" };
const OPS: Record<string, string> = { gte: "a partir de", gt: "maior que", lte: "até", lt: "menor que", eq: "igual a", is: "igual a", contains: "contém", in: "entre" };
const currency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyRuleDetails({ rule }: { rule: HypothesisDiscountRule }) {
  const params = rule.action.params;
  return <section className="strategy-detail-section strategy-proposal" aria-label="Condições da proposta">
    <p>{rule.action.type === "offer_free_shipping" ? "Frete grátis"
      : rule.action.type === "offer_discount" ? `${params.percent ?? ""}% de desconto` : rule.name}
      {params.maxDiscountReais != null && <> · até <strong>{currency(Number(params.maxDiscountReais))}</strong> por oferta</>}
    </p>
    {rule.conditions.length ? <ul>{rule.conditions.map((c, i) => <li key={i}>
      {FIELDS[c.field] ?? c.field} {OPS[c.operator] ?? c.operator}{" "}
      {c.field === "cart_total" && typeof c.value === "number" ? currency(c.value)
        : typeof c.value === "boolean" ? c.value ? "Sim" : "Não" : String(c.value)}
    </li>)}</ul> : <p>Válida sem condições adicionais.</p>}
  </section>;
}

function variant(value: unknown): { name?: string; system_prompt?: string; weight?: number } {
  return value && typeof value === "object" ? value : {};
}

export function StrategyReviewModal({ hypothesisId, merchantId, onClose, approvalDisabled = false }: {
  hypothesisId: string; merchantId: string; onClose: () => void; approvalDisabled?: boolean;
}) {
  const api = useApi();
  const working = useRef(false);
  const [hypothesis, setHypothesis] = useState<Hypothesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ApproveMode>("test_ab");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setHypothesis(null); setMode("test_ab");
    api.getHypothesis(hypothesisId).then(h => { if (active) setHypothesis(h); })
      .catch(() => { if (active) setError("Não foi possível carregar esta estratégia. Tente novamente."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, hypothesisId, merchantId, refresh]);

  const decide = async (approve: boolean) => {
    if (working.current || !hypothesis || hypothesis.status !== "pending_review" || (approve && approvalDisabled)) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (approve) {
        await api.approveHypothesis(hypothesis.id, { approved_by: merchantId, mode });
        showToast("success", mode === "test_ab" ? "Teste A/B iniciado. Acompanhe os resultados em Testes A/B." : "Estratégia aplicada à loja.");
      } else {
        await api.rejectHypothesis(hypothesis.id, { reason: "Declinada pelo lojista após revisão" });
        showToast("success", "Estratégia declinada.");
      }
      strategyChanged(hypothesis.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir. Verifique o estado da estratégia antes de tentar novamente.");
      // Refresh the authoritative state without hiding the failed action.
      const current = await api.getHypothesis(hypothesis.id).catch(() => null);
      if (current) setHypothesis(current);
      strategyChanged(hypothesis.id);
    } finally { working.current = false; setBusy(false); }
  };
  const rule = hypothesis?.template?.discount_rule_json;
  const simulation = hypothesis?.template?.discount_simulation;
  const canApplyDirect = hypothesis?.template?.hypothesis_type === "discount_rule" && !!rule;
  const a = variant(hypothesis?.template?.variant_a);
  const b = variant(hypothesis?.template?.variant_b);
  const weightSum = Number(a.weight ?? 0) + Number(b.weight ?? 0);
  const pending = hypothesis?.status === "pending_review";
  return <Modal isOpen title="Revisar estratégia" presentation="center" size="lg" subtitle="Confira as condições e escolha como aplicar a proposta."
    onClose={() => { if (!busy) onClose(); }}
    footer={hypothesis && pending ? <div className="strategy-review-actions">
      <button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={() => void decide(false)}>Declinar</button>
      <button type="button" className="zyn-btn zyn-btn--primary" disabled={busy || approvalDisabled} onClick={() => void decide(true)}>
        {mode === "test_ab" ? <FlaskConical size={16} /> : <Check size={16} />}
        {busy ? "Processando..." : mode === "test_ab" ? "Iniciar teste A/B" : "Aplicar estratégia"}
      </button>
    </div> : undefined}>
    <div className="strategy-review">
      {loading && <PageLoader />}
      {error && <div role="alert" className="strategy-review-error"><p>{error}</p>
        {!hypothesis && <button type="button" className="zyn-btn zyn-btn--secondary" onClick={() => setRefresh(x => x + 1)}>Tentar novamente</button>}
      </div>}
      {hypothesis && <>
        {approvalDisabled && <p role="status">Esta proposta antiga pode ser recusada, mas não pode iniciar um teste no ciclo semanal. Aguarde uma proposta com plano de medição e execução disponíveis.</p>}
        <h3 className="strategy-review-title">{hypothesis.hypothesis_text}</h3>
        {rule && <StrategyRuleDetails rule={rule} />}
        {pending && canApplyDirect && !approvalDisabled && <fieldset className="strategy-review-mode"><legend>Como deseja aplicar?</legend>
          <label><input type="radio" name="strategy-mode" checked={mode === "test_ab"} disabled={busy} onChange={() => setMode("test_ab")} /> Testar A/B</label>
          <label><input type="radio" name="strategy-mode" checked={mode === "apply_direct"} disabled={busy} onChange={() => setMode("apply_direct")} /> Aplicar direto</label>
        </fieldset>}
        {!approvalDisabled && <p className="strategy-review-explanation">{mode === "test_ab"
          ? `O teste compara a estratégia atual com ${rule ? "esta oferta" : "a nova abordagem"}. Acompanhe ou pause em Testes A/B.`
          : "A regra fica ativa nos atendimentos que cumprirem as condições acima. Você pode desativá-la nas configurações do checkout."}</p>}
        <details className="strategy-review-details">
          <summary>Ver detalhes da estratégia</summary>
          <div className="strategy-review-details-body">
            <section className="strategy-detail-section"><h3>Por que foi sugerida</h3><p>{hypothesis.reasoning || "Proposta para comparar com os resultados atuais da loja."}</p></section>
            <dl className="strategy-review-facts"><div><dt>Risco estimado</dt><dd>{RISK[hypothesis.risk_level]}</dd></div>
              <div><dt>{rule ? "Efeito na conversão" : "Impacto estimado"}</dt><dd>{rule ? "A medir"
                : `${hypothesis.expected_lift_percent > 0 ? "+" : ""}${hypothesis.expected_lift_percent.toLocaleString("pt-BR")}%`}</dd></div></dl>
            {simulation?.definition === "discount-catalog-replay-v1" && <section className="strategy-detail-section" aria-label="Simulação do desconto">
              <h3>Simulação do desconto</h3>
              <p>{simulation.sampleSize.toLocaleString("pt-BR")} compradores com janela de sete dias encerrada. Conversão observada: {(simulation.observedConversionRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%.</p>
              <p>Menor margem estimada entre os carrinhos: {simulation.minimumProjectedMarginPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%. Preços e custos do catálogo atual, com taxa de pagamento estimada de {simulation.paymentFeeAssumptionPercent}%.</p>
              <p>Se todos esses carrinhos recebessem a oferta, os descontos somariam {currency(simulation.replayDiscountTotalCents / 100)}. Esse valor não é uma previsão de gasto nem um orçamento reservado.</p>
              <p className="strategy-review-note">Tributos, frete, estornos e custo de IA não estão incluídos. A simulação não comprova lucro ou aumento de conversão.</p>
            </section>}
            {!rule && <p className="strategy-review-note">Estimativas do motor, sujeitas à validação pelos resultados.</p>}
            {!rule && <section className="strategy-detail-section">
              <h3>Abordagem proposta</h3><p className="strategy-review-copy">{b.system_prompt || "Detalhes da abordagem não disponíveis."}</p>
              <h3>Abordagem atual</h3><p className="strategy-review-copy">{a.system_prompt || "Abordagem atual da loja."}</p>
            </section>}
            {mode === "test_ab" && <section className="strategy-detail-section"><h3>Como funciona o teste</h3>
              <p>O grupo A mantém a estratégia atual. O grupo B recebe {rule ? "a regra proposta" : "a nova abordagem"}.</p>
              {weightSum > 0 && <p>Participantes: <strong>{Math.round(Number(a.weight) / weightSum * 100)}% no grupo A</strong> e <strong>{Math.round(Number(b.weight) / weightSum * 100)}% no grupo B</strong>.</p>}
              <p>{approvalDisabled ? "Este registro histórico não autoriza a execução de um experimento semanal." : "A aprovação inicia o experimento. A conclusão depende da amostra coletada."}</p>
            </section>}
            <p className="strategy-review-note">Os limites comerciais da loja continuam sendo verificados a cada oferta.</p>
          </div>
        </details>
        {!pending && <p role="status" className="strategy-review-note">{hypothesis.status === "experiment_failed"
          ? "A aprovação foi registrada, mas o teste não foi iniciado. Revise a falha em Otimização com IA."
          : "Esta estratégia já foi analisada e não está mais aguardando aprovação."}</p>}
      </>}
    </div>
  </Modal>;
}
