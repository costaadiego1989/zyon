import { useEffect, useRef, useState } from "react";
import type { CashbackCombinationRules, CashbackDraft, CashbackProgramView, CashbackRules } from "@zyon/shared-types";
import { ArrowRight, Check, Save, Coins, Clock3, ShoppingBag, Layers, FileText } from "lucide-react";
import { Button } from "../../components/Button.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { cashbackDecimal, cashbackFormFromRules, cashbackMoney, parseCashbackForm } from "./cashback-form.js";
import type { CashbackForm, LimitChoice } from "./cashback-form.js";
import { cashbackCombinationFormFromRules, parseCashbackCombinationForm, simulateCashbackCombination } from "./cashback-combination-form.js";
import type { CashbackCombinationForm } from "./cashback-combination-form.js";
import './cashback-settings.css';

type SettingsField = keyof CashbackForm | keyof CashbackCombinationForm;

interface Props {
  program: CashbackProgramView;
  busy: string | null;
  onSave: (rules: CashbackDraft, expectedRevision?: string) => Promise<unknown>;
  onPublish: (rules: CashbackRules) => Promise<unknown>;
  onReview?: () => Promise<CashbackProgramView | null>;
  reviewedProgram?: CashbackProgramView | null;
  onInvalidateReview?: () => void;
  needsReconciliation?: boolean;
  onReconcile?: () => Promise<unknown> | void;
}

export function CashbackSettings({ program, busy, onSave, onPublish, onReview, reviewedProgram, onInvalidateReview, needsReconciliation=false, onReconcile }: Props) {
  const [form, setForm] = useState(() => cashbackFormFromRules(program.draft ?? program.published));
  const [combinationForm, setCombinationForm] = useState(() => cashbackCombinationFormFromRules(program.draft ?? program.published));
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>({});
  const [review, setReview] = useState<CashbackRules | null>(null);
  const [dirty, setDirty] = useState(false);
  const [simulation, setSimulation] = useState("");
  const [simulationCoupon, setSimulationCoupon] = useState("");
  const [simulationAdvanced, setSimulationAdvanced] = useState("");
  const previousMerchant = useRef(program.merchantId);
  const baseRevision = useRef(program.configurationRevision);
  const formPanel = useRef<HTMLFormElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const simulationCents = cashbackDecimal(simulation);
  const couponCents = simulationCoupon.trim() ? cashbackDecimal(simulationCoupon) : 0;
  const advancedCents = simulationAdvanced.trim() ? cashbackDecimal(simulationAdvanced) : 0;
  const simulated = review && simulationCents !== null && couponCents !== null && advancedCents !== null
    ? simulateCashbackCombination(review, simulationCents, couponCents, advancedCents, program.generalDiscountCapBps) : null;
  const simulationInputError = simulation.trim() && (simulationCents === null || couponCents === null || advancedCents === null)
    ? "Informe valores em reais com no máximo duas casas decimais." : null;
  function loadServer() {
    previousMerchant.current = program.merchantId; baseRevision.current = program.configurationRevision;
    setForm(cashbackFormFromRules(program.draft ?? program.published));
    setCombinationForm(cashbackCombinationFormFromRules(program.draft ?? program.published));
    setErrors({}); setReview(null); setDirty(false); onInvalidateReview?.();
  }
  useEffect(() => {
    if (previousMerchant.current !== program.merchantId || !dirty) {
      previousMerchant.current = program.merchantId;
      baseRevision.current = program.configurationRevision;
      setForm(cashbackFormFromRules(program.draft ?? program.published));
      setCombinationForm(cashbackCombinationFormFromRules(program.draft ?? program.published));
      setErrors({}); setReview(null); setDirty(false);
    }
  }, [program.merchantId, program.configurationRevision, program.updatedAt, program.version, dirty]);
  useEffect(() => {
    if (!reviewedProgram?.configurationRevision) { setReview(null); return; }
    const persisted = parseForms(cashbackFormFromRules(reviewedProgram.draft), cashbackCombinationFormFromRules(reviewedProgram.draft), true);
    setErrors(persisted.errors);
    setReview(persisted.complete ? persisted.rules as CashbackRules : null);
  }, [reviewedProgram]);
  useEffect(() => {
    if (!review) return;
    reviewPanel.current?.focus({ preventScroll: true });
    reviewPanel.current?.scrollIntoView({ block: "start" });
  }, [review]);

  function update<K extends keyof CashbackForm>(key: K, value: CashbackForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined })); setDirty(true); setReview(null); onInvalidateReview?.();
  }
  function updateCombination<K extends keyof CashbackCombinationForm>(key: K, value: CashbackCombinationForm[K]) {
    setCombinationForm(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined })); setDirty(true); setReview(null); onInvalidateReview?.();
  }
  function parseForms(values: CashbackForm, combinations: CashbackCombinationForm, required: boolean) {
    const permissionsReady = !!combinations.combinationAllowCoupons && !!combinations.combinationAllowAdvancedRules;
    const legacy = parseCashbackForm({ ...values, allowWithDiscounts: permissionsReady
      ? combinations.combinationAllowCoupons === "yes" || combinations.combinationAllowAdvancedRules === "yes" ? "yes" : "no" : "" }, required);
    const combination = parseCashbackCombinationForm(combinations, required);
    // Existing snapshot conversion stays compatible; the current publication
    // form requires the new independent permissions and explicit combined cap.
    delete legacy.errors.allowWithDiscounts;
    const combinedErrors = { ...legacy.errors, ...combination.errors };
    const rules: Partial<CashbackRules> = { ...legacy.rules,
      ...(Object.keys(combination.combination).length ? { combination: combination.combination as CashbackCombinationRules } : {}) };
    const result = { rules, errors: combinedErrors, complete: legacy.complete && combination.complete && Object.keys(combinedErrors).length === 0 };
    return result;
  }
  function validate(required: boolean) {
    const result = parseForms(form, combinationForm, required);
    setErrors(result.errors);
    const first = Object.keys(result.errors)[0] as SettingsField | undefined;
    if (first) requestAnimationFrame(() => formPanel.current?.querySelector<HTMLElement>(`[data-cashback-field="${first}"] :is(input,select,textarea)`)?.focus());
    return result;
  }
  async function save() {
    const result = validate(false);
    if (Object.keys(result.errors).length) return;
    if (needsReconciliation) return;
    if (await onSave(result.rules, baseRevision.current)) setDirty(false);
  }
  async function showReview() {
    if (dirty || needsReconciliation || !onReview) return;
    const persisted = await onReview();
    if (persisted) {
      const result = parseForms(cashbackFormFromRules(persisted.draft), cashbackCombinationFormFromRules(persisted.draft), true);
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) requestAnimationFrame(() => formPanel.current?.querySelector<HTMLElement>(`[data-cashback-field="${first}"] :is(input,select,textarea)`)?.focus());
    }
  }
  async function publish() {
    if (!review) return;
    if (await onPublish(review)) { setDirty(false); setReview(null); }
  }
  function select(key: SettingsField, label: string, value: string, onChange: (value: string) => void, options: Array<{value:string;label:string}>, hint?: string) {
    return <div key={key} data-cashback-field={key}><FormSelect label={label} value={value} onChange={onChange} options={options} disabled={!!busy || needsReconciliation} error={errors[key]} hint={hint} inputProps={{name:key}}/></div>;
  }
  function text(key: keyof CashbackForm, label: string, help?: string, mode: "decimal" | "numeric" = "decimal") {
    return <div key={key} data-cashback-field={key}><FormField label={label} value={form[key]} onChange={value=>update(key,value as never)} disabled={!!busy || needsReconciliation} error={errors[key]} hint={help} inputProps={{name:key,inputMode:mode,autoComplete:'off'}}/></div>;
  }
  function optionalLimit(choice: keyof CashbackForm, amount: keyof CashbackForm, label: string) {
    return <div className="cashback-limit" key={choice}>
      {select(choice,label,form[choice],value=>update(choice,value as LimitChoice),[{value:'',label:'Selecione uma condição'},{value:'limited',label:'Definir valor máximo'},{value:'unlimited',label:'Sem limite'}])}
      {form[choice] === "limited" && text(amount, `${label} — valor em R$`)}
    </div>;
  }
  function combinationSelect(key: "combinationAllowCoupons" | "combinationAllowAdvancedRules", label: string) {
    return select(key,label,combinationForm[key],value=>updateCombination(key,value as "" | "yes" | "no"),[{value:'',label:'Selecione a permissão'},{value:'yes',label:'Permitir'},{value:'no',label:'Não permitir'}]);
  }
  function combinationLimit(choice: "combinationPercentChoice" | "combinationMoneyChoice", amount: "combinationPercent" | "combinationMoney", label: string, valueLabel: string) {
    return <div className="cashback-limit" key={choice}>
      {select(choice,label,combinationForm[choice],value=>updateCombination(choice,value as LimitChoice),[{value:'',label:'Selecione uma condição'},{value:'limited',label:'Definir teto'},{value:'unlimited',label:'Não usar este tipo de teto'}])}
      {combinationForm[choice] === "limited" && <div data-cashback-field={amount}><FormField label={valueLabel} value={combinationForm[amount]} onChange={value=>updateCombination(amount,value)} error={errors[amount]} disabled={!!busy || needsReconciliation} inputProps={{name:amount,inputMode:'decimal',autoComplete:'off'}}/></div>}
    </div>;
  }
  return <section className="cashback-settings" aria-label="Regras do programa">
    <div className="cashback-settings-heading"><SectionHeader title="Regras do programa" subtitle="Preencha cada condição. Nenhuma regra comercial é ativada automaticamente." trailing={dirty ? <span className="cashback-status">Alterações não salvas</span> : <span className="cashback-help">Rascunho salvo · ativação após revisão</span>}/></div>
    {dirty && <p className="cashback-settings-notice" role="status">Salve as alterações antes de revisar. O programa publicado continua seguindo as regras atuais.</p>}
    {dirty && baseRevision.current !== program.configurationRevision && <div className="cashback-settings-notice" role="status"><p>O rascunho salvo foi alterado pelo assistente ou por outra sessão. Seus campos e sua revisão de origem foram mantidos.</p><Button variant="outline" disabled={!!busy || needsReconciliation} onClick={loadServer}>Carregar rascunho atual</Button></div>}
    {needsReconciliation && <div className="cashback-settings-notice" role="alert"><p>Confira o resultado da operação antes de salvar ou publicar novamente. Seus campos foram mantidos.</p><Button variant="outline" disabled={!!busy} onClick={()=>void (async()=>{if(await onReconcile?.())setDirty(false);})()}>Conferir resultado e retomar</Button></div>}
    <form ref={formPanel} className="cashback-settings-form" noValidate onSubmit={event => { event.preventDefault(); void showReview(); }}>
      <fieldset className="panel cashback-settings-group" disabled={!!busy || needsReconciliation}><legend><Coins size={18} aria-hidden="true"/>Como ganhar</legend><p className="cashback-help">Produtos físicos, digitais, serviços e comida próprios desta loja. Frete e taxas não geram crédito.</p>
        <div className="cashback-fields">
          {text("earnRatePercent", "Percentual de cashback (%)", "Percentual sobre os produtos elegíveis, após descontos e cashback usado.")}
          {text("minimumEarn", "Compra mínima para ganhar (R$)", "Informe 0 para não exigir um valor mínimo.")}
          {optionalLimit("maximumEarnPerOrderChoice", "maximumEarnPerOrder", "Ganho máximo por pedido")}
          {optionalLimit("buyerMonthlyEarnLimitChoice", "buyerMonthlyEarnLimit", "Ganho máximo por cliente no mês")}
          {optionalLimit("monthlyBudgetChoice", "monthlyBudget", "Orçamento mensal da loja")}
        </div>
      </fieldset>
      <fieldset className="panel cashback-settings-group" disabled={!!busy || needsReconciliation}><legend><Clock3 size={18} aria-hidden="true"/>Quando liberar e até quando usar</legend><div className="cashback-fields">
        {select("releaseTrigger","Marco de liberação",form.releaseTrigger,value=>update('releaseTrigger',value as CashbackForm['releaseTrigger']),[{value:'',label:'Selecione o marco'},{value:'payment_confirmed',label:'Pagamento confirmado'},{value:'order_fulfilled',label:'Pedido concluído'}],"Pedido concluído exige a entrega ou execução comprovada de todos os itens, incluindo serviços e digitais.")}
        {text("releaseDelayDays", "Carência após o marco (dias)", "Informe 0 para liberar assim que o marco for confirmado.", "numeric")}
        {select("expiryChoice","Validade do crédito",form.expiryChoice,value=>update('expiryChoice',value as LimitChoice),[{value:'',label:'Selecione a validade'},{value:'limited',label:'Definir prazo após a liberação'},{value:'unlimited',label:'Sem vencimento'}])}
        {form.expiryChoice === "limited" && text("expiryDays", "Validade após a liberação (dias)", "O prazo começa quando o crédito fica disponível.", "numeric")}
      </div></fieldset>
      <fieldset className="panel cashback-settings-group" disabled={!!busy || needsReconciliation}><legend><ShoppingBag size={18} aria-hidden="true"/>Como usar</legend><div className="cashback-fields">
        {text("minimumRedeemOrder", "Compra mínima para usar (R$)", "Informe 0 para não exigir mínimo. Frete e taxas não entram nesta base.")}
        {text("maximumRedeemPercent", "Limite de uso por compra (%)", "Deve ser menor que 100%. O cliente pode escolher usar menos que o limite.")}
        {optionalLimit("maximumRedeemChoice", "maximumRedeem", "Valor máximo de uso por compra")}
      </div></fieldset>
      <fieldset className="panel cashback-settings-group" disabled={!!busy || needsReconciliation}><legend><Layers size={18} aria-hidden="true"/>Combinar benefícios sem ultrapassar o teto</legend>
        <p className="cashback-help">Cupom e regra avançada entram pelo valor efetivo de desconto. O cashback é aplicado por último e reduzido ao espaço restante; o saldo não utilizado continua na carteira. As mesmas condições valem no site e no WhatsApp.</p>
        {typeof (program.draft ?? program.published)?.allowWithDiscounts === "boolean" && !(program.draft ?? program.published)?.combination && <p className="cashback-combination-note">Estas regras ainda usam a configuração anterior. Escolha as permissões e o teto para publicar uma nova versão; os créditos anteriores preservam suas condições.</p>}
        <div className="cashback-fields">
          {combinationSelect("combinationAllowCoupons", "Combinar cashback com cupons")}
          {combinationSelect("combinationAllowAdvancedRules", "Combinar cashback com regras avançadas")}
          {select("combinationLimitMode", "Qual teto deve prevalecer?", combinationForm.combinationLimitMode,value=>updateCombination("combinationLimitMode",value as CashbackCombinationForm['combinationLimitMode']),[{value:'',label:'Selecione o modo de teto'},{value:'respect_general',label:'Respeitar também o teto geral da loja'},{value:'cashback_specific',label:'Usar teto específico para compras com cashback'}], combinationForm.combinationLimitMode === "cashback_specific"
            ? "O teto específico pode ser maior que o geral, mas a soma dos benefícios continua limitada ao valor que você definir. Validade, exclusividade e demais condições continuam valendo."
            : program.generalDiscountCapBps != null ? `Teto geral atual: ${program.generalDiscountCapBps / 100}%. Prevalece o menor teto aplicável.` : "O teto geral das regras avançadas será validado no checkout. Nenhum valor é presumido aqui.")}
          {combinationLimit("combinationPercentChoice", "combinationPercent", "Teto conjunto em percentual", "Teto conjunto dos benefícios (%)")}
          {combinationLimit("combinationMoneyChoice", "combinationMoney", "Teto conjunto em reais", "Teto conjunto dos benefícios (R$)")}
        </div>
        <p className="cashback-help cashback-combination-footnote">Defina pelo menos um teto. Se informar percentual e reais, vale o menor. Permitir cashback com cupom não muda a validade nem a exclusividade do cupom.</p>
      </fieldset>
      <fieldset className="panel cashback-settings-group" disabled={!!busy || needsReconciliation}><legend><FileText size={18} aria-hidden="true"/>Regulamento apresentado ao cliente</legend>
        <div data-cashback-field="terms"><FormTextarea label="Condições do cashback" value={form.terms} rows={7} maxLength={10000} error={errors.terms} onChange={value=>update('terms',value)} disabled={!!busy || needsReconciliation} inputProps={{name:'terms'}} hint="Explique ganho, liberação, uso, validade e devoluções. O crédito é financiado pela loja e utilizável em compras futuras nesta mesma loja. Publicar novas regras não altera créditos anteriores."/></div>
      </fieldset>
      <div className="cashback-form-actions"><Button variant="outline" aria-label="Salvar rascunho" loading={busy === "save"} disabled={!!busy || needsReconciliation} onClick={() => void save()}><Save size={16} aria-hidden="true"/>Salvar rascunho</Button><Button type="submit" aria-label="Revisar regras salvas" disabled={!!busy || dirty || needsReconciliation}>Revisar regras salvas<ArrowRight size={16} aria-hidden="true"/></Button></div>
    </form>
    {review && <div ref={reviewPanel} className="panel cashback-review" aria-label="Revisão da publicação" tabIndex={-1}>
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
          <FormField label="Valor dos produtos (R$)" value={simulation} onChange={setSimulation} inputProps={{inputMode:'decimal'}}/>
          <FormField label="Desconto efetivo do cupom (R$)" value={simulationCoupon} onChange={setSimulationCoupon} inputProps={{inputMode:'decimal'}}/>
          <FormField label="Desconto efetivo da regra avançada (R$)" value={simulationAdvanced} onChange={setSimulationAdvanced} inputProps={{inputMode:'decimal'}}/>
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
      <div className="cashback-form-actions"><Button variant="outline" disabled={!!busy} onClick={() => {setReview(null);onInvalidateReview?.();}}>Voltar às regras</Button><Button aria-label="Publicar e ativar" loading={busy === "publish"} disabled={!!busy || needsReconciliation} onClick={() => void publish()}><Check size={16} aria-hidden="true"/>Publicar e ativar</Button></div>
    </div>}
  </section>;
}
