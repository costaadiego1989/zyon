import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CashbackCombinationRules, CashbackProgramView, CashbackRules } from "@zyon/shared-types";
import { ArrowRight, Check, Save } from "lucide-react";
import { Button } from "../../components/Button.js";
import { cashbackDecimal, cashbackFormFromRules, cashbackMoney, parseCashbackForm } from "./cashback-form.js";
import type { CashbackForm, LimitChoice } from "./cashback-form.js";
import { cashbackCombinationFormFromRules, parseCashbackCombinationForm, simulateCashbackCombination } from "./cashback-combination-form.js";
import type { CashbackCombinationForm } from "./cashback-combination-form.js";

type SettingsField = keyof CashbackForm | keyof CashbackCombinationForm;

interface Props {
  program: CashbackProgramView;
  busy: string | null;
  onSave: (rules: Partial<CashbackRules>) => Promise<unknown>;
  onPublish: (rules: CashbackRules) => Promise<unknown>;
}

export function CashbackSettings({ program, busy, onSave, onPublish }: Props) {
  const [form, setForm] = useState(() => cashbackFormFromRules(program.draft ?? program.published));
  const [combinationForm, setCombinationForm] = useState(() => cashbackCombinationFormFromRules(program.draft ?? program.published));
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>({});
  const [review, setReview] = useState<CashbackRules | null>(null);
  const [dirty, setDirty] = useState(false);
  const [simulation, setSimulation] = useState("");
  const [simulationCoupon, setSimulationCoupon] = useState("");
  const [simulationAdvanced, setSimulationAdvanced] = useState("");
  const previousMerchant = useRef(program.merchantId);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const simulationCents = cashbackDecimal(simulation);
  const couponCents = simulationCoupon.trim() ? cashbackDecimal(simulationCoupon) : 0;
  const advancedCents = simulationAdvanced.trim() ? cashbackDecimal(simulationAdvanced) : 0;
  const simulated = review && simulationCents !== null && couponCents !== null && advancedCents !== null
    ? simulateCashbackCombination(review, simulationCents, couponCents, advancedCents, program.generalDiscountCapBps) : null;
  const simulationInputError = simulation.trim() && (simulationCents === null || couponCents === null || advancedCents === null)
    ? "Informe valores em reais com no máximo duas casas decimais." : null;
  const id = (key: SettingsField) => `${prefix}-${key}`;
  useEffect(() => {
    if (previousMerchant.current !== program.merchantId || !dirty) {
      previousMerchant.current = program.merchantId;
      setForm(cashbackFormFromRules(program.draft ?? program.published));
      setCombinationForm(cashbackCombinationFormFromRules(program.draft ?? program.published));
      setErrors({}); setReview(null); setDirty(false);
    }
  }, [program.merchantId, program.updatedAt, program.version]);
  useEffect(() => {
    if (!review) return;
    reviewPanel.current?.focus({ preventScroll: true });
    reviewPanel.current?.scrollIntoView({ block: "start" });
  }, [review]);

  function update<K extends keyof CashbackForm>(key: K, value: CashbackForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined })); setDirty(true); setReview(null);
  }
  function updateCombination<K extends keyof CashbackCombinationForm>(key: K, value: CashbackCombinationForm[K]) {
    setCombinationForm(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined })); setDirty(true); setReview(null);
  }
  function validate(required: boolean) {
    const permissionsReady = !!combinationForm.combinationAllowCoupons && !!combinationForm.combinationAllowAdvancedRules;
    const legacy = parseCashbackForm({ ...form, allowWithDiscounts: permissionsReady
      ? combinationForm.combinationAllowCoupons === "yes" || combinationForm.combinationAllowAdvancedRules === "yes" ? "yes" : "no" : "" }, required);
    const combination = parseCashbackCombinationForm(combinationForm, required);
    // Existing snapshot conversion stays compatible; the current publication
    // form requires the new independent permissions and explicit combined cap.
    delete legacy.errors.allowWithDiscounts;
    const combinedErrors = { ...legacy.errors, ...combination.errors };
    const rules: Partial<CashbackRules> = { ...legacy.rules,
      ...(Object.keys(combination.combination).length ? { combination: combination.combination as CashbackCombinationRules } : {}) };
    const result = { rules, errors: combinedErrors, complete: legacy.complete && combination.complete && Object.keys(combinedErrors).length === 0 };
    setErrors(combinedErrors);
    const first = Object.keys(combinedErrors)[0] as SettingsField | undefined;
    if (first) requestAnimationFrame(() => document.getElementById(id(first))?.focus());
    return result;
  }
  async function save() {
    const result = validate(false);
    if (Object.keys(result.errors).length) return;
    if (await onSave(result.rules)) setDirty(false);
  }
  function showReview() {
    const result = validate(true);
    if (result.complete) setReview(result.rules as CashbackRules);
  }
  async function publish() {
    if (!review) return;
    if (await onPublish(review)) { setDirty(false); setReview(null); }
  }
  function field(key: SettingsField, label: string, control: ReactNode, help?: string) {
    return <div className="cashback-field" key={key}>
      <label htmlFor={id(key)}>{label}</label>{control}
      {help && <p id={`${id(key)}-help`} className="cashback-help">{help}</p>}
      {errors[key] && <p id={`${id(key)}-error`} className="cashback-field-error" role="alert">{errors[key]}</p>}
    </div>;
  }
  function text(key: keyof CashbackForm, label: string, help?: string, mode: "decimal" | "numeric" = "decimal") {
    return field(key, label, <input id={id(key)} name={key} value={form[key]} onChange={event => update(key, event.target.value as never)} inputMode={mode}
      autoComplete="off" disabled={!!busy} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id(key)}-error` : help ? `${id(key)}-help` : undefined} />, help);
  }
  function optionalLimit(choice: keyof CashbackForm, amount: keyof CashbackForm, label: string) {
    return <div className="cashback-limit" key={choice}>
      {field(choice, label, <select id={id(choice)} name={choice} value={form[choice]} disabled={!!busy} aria-invalid={!!errors[choice]} onChange={event => update(choice, event.target.value as LimitChoice)}>
        <option value="">Selecione uma condição</option><option value="limited">Definir valor máximo</option><option value="unlimited">Sem limite</option>
      </select>)}
      {form[choice] === "limited" && text(amount, `${label} — valor em R$`)}
    </div>;
  }
  function combinationSelect(key: "combinationAllowCoupons" | "combinationAllowAdvancedRules", label: string) {
    return field(key, label, <select id={id(key)} name={key} value={combinationForm[key]} aria-invalid={!!errors[key]}
      aria-describedby={errors[key] ? `${id(key)}-error` : undefined}
      onChange={event => updateCombination(key, event.target.value as "" | "yes" | "no")}>
      <option value="">Selecione a permissão</option><option value="yes">Permitir</option><option value="no">Não permitir</option>
    </select>);
  }
  function combinationLimit(choice: "combinationPercentChoice" | "combinationMoneyChoice", amount: "combinationPercent" | "combinationMoney", label: string, valueLabel: string) {
    return <div className="cashback-limit" key={choice}>
      {field(choice, label, <select id={id(choice)} name={choice} value={combinationForm[choice]} aria-invalid={!!errors[choice]}
        aria-describedby={errors[choice] ? `${id(choice)}-error` : undefined}
        onChange={event => updateCombination(choice, event.target.value as LimitChoice)}>
        <option value="">Selecione uma condição</option><option value="limited">Definir teto</option><option value="unlimited">Não usar este tipo de teto</option>
      </select>)}
      {combinationForm[choice] === "limited" && field(amount, valueLabel, <input id={id(amount)} name={amount} inputMode="decimal" autoComplete="off"
        value={combinationForm[amount]} aria-invalid={!!errors[amount]} aria-describedby={errors[amount] ? `${id(amount)}-error` : undefined}
        onChange={event => updateCombination(amount, event.target.value)} />)}
    </div>;
  }
  return <section className="panel cashback-settings" aria-labelledby={`${prefix}-title`}>
    <div className="cashback-section-heading"><div><h2 id={`${prefix}-title`}>Regras do programa</h2><p>Preencha cada condição. Nenhuma regra comercial é ativada automaticamente.</p></div>{dirty && <span className="cashback-status">Alterações não publicadas</span>}</div>
    <form noValidate onSubmit={event => { event.preventDefault(); showReview(); }}>
      <fieldset disabled={!!busy}><legend>Como ganhar</legend><p className="cashback-help">Produtos físicos, digitais, serviços e comida próprios desta loja. Frete e taxas não geram crédito.</p>
        <div className="cashback-fields">
          {text("earnRatePercent", "Percentual de cashback (%)", "Percentual sobre os produtos elegíveis, após descontos e cashback usado.")}
          {text("minimumEarn", "Compra mínima para ganhar (R$)", "Informe 0 para não exigir um valor mínimo.")}
          {optionalLimit("maximumEarnPerOrderChoice", "maximumEarnPerOrder", "Ganho máximo por pedido")}
          {optionalLimit("buyerMonthlyEarnLimitChoice", "buyerMonthlyEarnLimit", "Ganho máximo por cliente no mês")}
          {optionalLimit("monthlyBudgetChoice", "monthlyBudget", "Orçamento mensal da loja")}
        </div>
      </fieldset>
      <fieldset disabled={!!busy}><legend>Quando liberar e até quando usar</legend><div className="cashback-fields">
        {field("releaseTrigger", "Marco de liberação", <select id={id("releaseTrigger")} name="releaseTrigger" value={form.releaseTrigger} aria-invalid={!!errors.releaseTrigger} onChange={event => update("releaseTrigger", event.target.value as CashbackForm["releaseTrigger"])}>
          <option value="">Selecione o marco</option><option value="payment_confirmed">Pagamento confirmado</option><option value="order_fulfilled">Pedido concluído</option>
        </select>, "Pedido concluído exige a entrega ou execução comprovada de todos os itens, incluindo serviços e digitais.")}
        {text("releaseDelayDays", "Carência após o marco (dias)", "Informe 0 para liberar assim que o marco for confirmado.", "numeric")}
        {field("expiryChoice", "Validade do crédito", <select id={id("expiryChoice")} name="expiryChoice" value={form.expiryChoice} aria-invalid={!!errors.expiryChoice} onChange={event => update("expiryChoice", event.target.value as LimitChoice)}>
          <option value="">Selecione a validade</option><option value="limited">Definir prazo após a liberação</option><option value="unlimited">Sem vencimento</option>
        </select>)}
        {form.expiryChoice === "limited" && text("expiryDays", "Validade após a liberação (dias)", "O prazo começa quando o crédito fica disponível.", "numeric")}
      </div></fieldset>
      <fieldset disabled={!!busy}><legend>Como usar</legend><div className="cashback-fields">
        {text("minimumRedeemOrder", "Compra mínima para usar (R$)", "Informe 0 para não exigir mínimo. Frete e taxas não entram nesta base.")}
        {text("maximumRedeemPercent", "Limite de uso por compra (%)", "Deve ser menor que 100%. O cliente pode escolher usar menos que o limite.")}
        {optionalLimit("maximumRedeemChoice", "maximumRedeem", "Valor máximo de uso por compra")}
      </div></fieldset>
      <fieldset disabled={!!busy}><legend>Combinar benefícios sem ultrapassar o teto</legend>
        <p className="cashback-help">Cupom e regra avançada entram pelo valor efetivo de desconto. O cashback é aplicado por último e reduzido ao espaço restante; o saldo não utilizado continua na carteira. As mesmas condições valem no site e no WhatsApp.</p>
        {typeof (program.draft ?? program.published)?.allowWithDiscounts === "boolean" && !(program.draft ?? program.published)?.combination && <p className="cashback-combination-note">Estas regras ainda usam a configuração anterior. Escolha as permissões e o teto para publicar uma nova versão; os créditos anteriores preservam suas condições.</p>}
        <div className="cashback-fields">
          {combinationSelect("combinationAllowCoupons", "Combinar cashback com cupons")}
          {combinationSelect("combinationAllowAdvancedRules", "Combinar cashback com regras avançadas")}
          {field("combinationLimitMode", "Qual teto deve prevalecer?", <select id={id("combinationLimitMode")} name="combinationLimitMode" value={combinationForm.combinationLimitMode}
            aria-invalid={!!errors.combinationLimitMode} aria-describedby={errors.combinationLimitMode ? `${id("combinationLimitMode")}-error` : `${id("combinationLimitMode")}-help`}
            onChange={event => updateCombination("combinationLimitMode", event.target.value as CashbackCombinationForm["combinationLimitMode"])}>
            <option value="">Selecione o modo de teto</option><option value="respect_general">Respeitar também o teto geral da loja</option><option value="cashback_specific">Usar teto específico para compras com cashback</option>
          </select>, combinationForm.combinationLimitMode === "cashback_specific"
            ? "O teto específico pode ser maior que o geral, mas a soma dos benefícios continua limitada ao valor que você definir. Validade, exclusividade e demais condições continuam valendo."
            : program.generalDiscountCapBps != null ? `Teto geral atual: ${program.generalDiscountCapBps / 100}%. Prevalece o menor teto aplicável.` : "O teto geral das regras avançadas será validado no checkout. Nenhum valor é presumido aqui.")}
          {combinationLimit("combinationPercentChoice", "combinationPercent", "Teto conjunto em percentual", "Teto conjunto dos benefícios (%)")}
          {combinationLimit("combinationMoneyChoice", "combinationMoney", "Teto conjunto em reais", "Teto conjunto dos benefícios (R$)")}
        </div>
        <p className="cashback-help cashback-combination-footnote">Defina pelo menos um teto. Se informar percentual e reais, vale o menor. Permitir cashback com cupom não muda a validade nem a exclusividade do cupom.</p>
      </fieldset>
      <fieldset disabled={!!busy}><legend>Regulamento apresentado ao cliente</legend>
        {field("terms", "Condições do cashback", <textarea id={id("terms")} name="terms" value={form.terms} rows={7} maxLength={10000} aria-invalid={!!errors.terms} onChange={event => update("terms", event.target.value)} />,
          "Explique ganho, liberação, uso, validade e devoluções. O crédito é financiado pela loja e utilizável em compras futuras nesta mesma loja. Publicar novas regras não altera créditos anteriores.")}
      </fieldset>
      <div className="cashback-form-actions"><Button variant="outline" loading={busy === "save"} disabled={!!busy} onClick={() => void save()}><Save size={16} /> Salvar rascunho</Button><Button type="submit" disabled={!!busy}>Revisar e publicar <ArrowRight size={16} /></Button></div>
    </form>
    {review && <div ref={reviewPanel} className="cashback-review" aria-label="Revisão da publicação" tabIndex={-1}>
      <h3>Confira antes de ativar</h3><p>Os próximos pedidos elegíveis no site e no WhatsApp seguirão estas condições. O saldo anterior conserva suas regras.</p>
      <dl className="cashback-definition-list">
        <div><dt>Ganho</dt><dd>{review.earnRateBps / 100}% · compra mínima de {cashbackMoney(review.minimumEarnCents)}</dd></div>
        <div><dt>Ganho máximo por pedido</dt><dd>{review.maximumEarnPerOrderCents === null ? "Sem limite" : cashbackMoney(review.maximumEarnPerOrderCents)}</dd></div>
        <div><dt>Ganho máximo por cliente no mês</dt><dd>{review.buyerMonthlyEarnLimitCents === null ? "Sem limite" : cashbackMoney(review.buyerMonthlyEarnLimitCents)}</dd></div>
        <div><dt>Liberação</dt><dd>{review.releaseDelayDays} dia(s) após {review.releaseTrigger === "payment_confirmed" ? "pagamento confirmado" : "conclusão do pedido"}</dd></div>
        <div><dt>Validade</dt><dd>{review.expiryDays === null ? "Sem vencimento" : `${review.expiryDays} dias após a liberação`}</dd></div>
        <div><dt>Uso</dt><dd>Até {review.maximumRedeemBps / 100}% · compra mínima de {cashbackMoney(review.minimumRedeemOrderCents)}</dd></div>
        <div><dt>Valor máximo de uso por compra</dt><dd>{review.maximumRedeemCents === null ? "Sem limite monetário adicional" : cashbackMoney(review.maximumRedeemCents)}</dd></div>
        <div><dt>Orçamento mensal</dt><dd>{review.monthlyBudgetCents === null ? "Sem limite" : cashbackMoney(review.monthlyBudgetCents)}</dd></div>
        <div><dt>Cashback com cupons</dt><dd>{review.combination?.allowCoupons ? "Permitido" : "Não permitido"}</dd></div>
        <div><dt>Cashback com regras avançadas</dt><dd>{review.combination?.allowAdvancedRules ? "Permitido" : "Não permitido"}</dd></div>
        <div><dt>Modo de teto</dt><dd>{review.combination?.limitMode === "cashback_specific" ? "Teto específico para compras com cashback" : "Menor entre o teto geral e o conjunto"}</dd></div>
        <div><dt>Teto da soma dos benefícios</dt><dd>{[
          review.combination?.maximumCombinedDiscountBps == null ? null : `${review.combination.maximumCombinedDiscountBps / 100}% dos produtos`,
          review.combination?.maximumCombinedDiscountCents == null ? null : cashbackMoney(review.combination.maximumCombinedDiscountCents),
        ].filter(Boolean).join(" ou ")} · vale o menor</dd></div>
      </dl>
      <div className="cashback-simulation" aria-label="Simulação dos benefícios"><h3>Confira a soma antes de publicar</h3>
        <div className="cashback-fields">
          <label className="cashback-field">Valor dos produtos para simular (R$)<input value={simulation} onChange={event => setSimulation(event.target.value)} inputMode="decimal" /></label>
          <label className="cashback-field">Desconto efetivo do cupom (R$)<input value={simulationCoupon} onChange={event => setSimulationCoupon(event.target.value)} inputMode="decimal" /></label>
          <label className="cashback-field">Desconto efetivo da regra avançada (R$)<input value={simulationAdvanced} onChange={event => setSimulationAdvanced(event.target.value)} inputMode="decimal" /></label>
        </div>
        {(simulationInputError || simulated?.error) && <p role="alert" className="cashback-field-error">{simulationInputError ?? simulated?.error}</p>}
        {simulated && !simulated.error && simulated.maximumCashbackCents !== null && simulated.totalCents !== null && simulated.earnedCents !== null && <div role="status" className="cashback-simulation-result">
          <p>Cupom e regra avançada: <strong>{cashbackMoney(simulated.discountsCents)}</strong>. Teto conjunto: <strong>{cashbackMoney(simulated.combinedLimitCents!)}</strong>.</p>
          <p>Cashback máximo nesta compra: <strong>{cashbackMoney(simulated.maximumCashbackCents)}</strong>.</p>
          <p>Produtos após todos os benefícios: <strong>{cashbackMoney(simulated.totalCents)}</strong>. Ganho estimado com esse uso: <strong>{cashbackMoney(simulated.earnedCents)}</strong>.</p>
        </div>}
        <p className="cashback-help">Informe somente os descontos sobre produtos. Deixe o cupom ou a regra em branco para simular sem esse benefício. A simulação usa o cashback máximo permitido e não inclui frete ou taxas. O uso real depende do saldo e das demais condições do checkout, incluindo a margem mínima; o ganho depende do orçamento disponível.</p>
      </div>
      <details><summary>Ver regulamento que será publicado</summary><p className="cashback-terms">{review.terms}</p></details>
      <div className="cashback-form-actions"><Button variant="outline" disabled={!!busy} onClick={() => setReview(null)}>Voltar às regras</Button><Button loading={busy === "publish"} disabled={!!busy} onClick={() => void publish()}><Check size={16} /> Publicar e ativar</Button></div>
    </div>}
  </section>;
}
