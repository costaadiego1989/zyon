import React, { useId, useRef, useState } from "react";
import { Check, Save } from "lucide-react";
import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FormField, FormSelect } from "../../components/FormField.js";
import { useCrossSellPage, type CrossSellContext } from "./useCrossSellPage.js";
import type { CrossSellTouchpoint, CrossSellStrategy, CrossSellDisplayMode } from "@zyon/shared-types";
import "../../components/configuration-form.css";
import "./cross-sell.css";

const MOMENTS: Record<CrossSellTouchpoint, [string, string]> = {
  browsing: ["Durante a navegação", "Sugere produtos enquanto o cliente navega pela loja."],
  pre_cart: ["Nos produtos", "Mostra complementos nos detalhes do produto."],
  post_cart: ["Após adicionar ao carrinho", "Depois que o produto é adicionado com sucesso."],
  pre_checkout: ["Antes de ir para o checkout", "Mostra complementos ao finalizar o carrinho, antes do login e da entrada no checkout."],
  pre_payment: ["No checkout", "Mostra complementos durante o checkout, antes do pagamento."],
  post_purchase: ["Após a compra", "Na confirmação do pedido."],
};
const STRATEGIES: Record<CrossSellStrategy, [string, string]> = {
  same_category: ["Mesma categoria", "Outros produtos da categoria que o cliente está consultando."],
  bought_together: ["Comprados juntos", "Combinações identificadas no histórico de compras."],
  cart_value_upgrade: ["Opções de maior valor", "Alternativas de maior valor conforme as condições do carrinho."],
  complementary: ["Itens que se complementam", "Exemplo: uma capa para acompanhar um celular."],
  ai_personalized: ["Sugestões personalizadas por IA", "Produtos escolhidos a partir do contexto da conversa."],
};
const DISPLAY: Array<{ value: CrossSellDisplayMode; label: string }> = [
  { value: "inline", label: "Na conversa" }, { value: "modal", label: "Janela sobre a página" },
  { value: "banner", label: "Faixa no topo" }, { value: "interstitial", label: "Painel sobre a etapa da compra" },
];

function CrossSellChoice({ type, name, checked, title, description, onChange }: {
  type: "checkbox" | "radio";
  name?: string;
  checked: boolean;
  title: string;
  description: string;
  onChange: () => void;
}) {
  const id = useId();
  return <label className="cross-sell-choice">
    <input type={type} name={name} checked={checked} onChange={onChange}
      aria-labelledby={id + '-title'} aria-describedby={id + '-description'} />
    <span className="cross-sell-choice__content">
      <strong id={id + '-title'}>{title}</strong>
      <small id={id + '-description'}>{description}</small>
    </span>
    {type === "radio" ? <span className="cross-sell-choice__radio" aria-hidden="true" /> : <Check className="cross-sell-choice__check" size={20} strokeWidth={2} aria-hidden="true" />}
  </label>;
}

export function CrossSellPage({ context }: { context: CrossSellContext }) {
  const vm = useCrossSellPage(context);
  const { config, loading, saving } = vm.state;
  const id = useId(); const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const error = (key: string) => submitted ? vm.fieldErrors[key] : undefined;
  function save(event: React.FormEvent) {
    event.preventDefault(); setSubmitted(true); void vm.save();
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"], [aria-invalid="true"] input')?.focus());
  }
  return <div className="page-container cross-sell-page">
    <PageHeader title="Produtos complementares" description={context === "store" ? "Configure as sugestões que acompanham a escolha de produtos na loja." : "Configure as sugestões apresentadas durante o checkout."}
      actions={<Button type="submit" form={id} loading={saving} disabled={loading || !!vm.loadError || !vm.dirty}><Save size={16} /> Salvar sugestões</Button>} />
    <SetupGuide title="Como configurar as sugestões" steps={[
      { title: "Escolha o momento", description: "Marque as etapas da compra em que uma sugestão faz sentido." },
      { title: "Defina os produtos", description: "Escolha a estratégia de recomendação para sua loja." },
      { title: "Revise e salve", description: "Confira frequência, desconto e apresentação. As mudanças entram em vigor ao salvar." },
    ]} />
    {loading ? <div className="panel" role="status" style={{ padding: 24 }}>Carregando configurações…</div> : vm.loadError ?
      <EmptyState title="Configurações indisponíveis" description={vm.loadError} action={<Button variant="outline" onClick={vm.reload}>Tentar novamente</Button>} /> :
      <form id={id} ref={formRef} onSubmit={save} noValidate className="cross-sell-editor">
        <fieldset className="configuration-form" disabled={saving} aria-busy={saving}>
          {vm.saveError && <p className="form-field-error" role="alert">{vm.saveError}</p>}
          <section className="configuration-form__section">
            <div className="cross-sell-switch">
              <div><label htmlFor={id + '-enabled'}>Sugestões de produtos</label><p>Ative para oferecer produtos relacionados durante a compra.</p></div>
              <ToggleSwitch id={id + '-enabled'} checked={config.enabled} disabled={saving} onChange={enabled => vm.patchConfig({ enabled })} />
            </div>
            {!config.enabled && <p>As sugestões estão desativadas neste rascunho. Salve para aplicar essa escolha.</p>}
          </section>
          {config.enabled && <>
            <section className="configuration-form__section" aria-labelledby={id + '-moments'}>
              <h3 id={id + '-moments'}>Quando sugerir</h3><p id={id + '-moments-hint'}>Você pode escolher mais de um momento.</p>
              <div className="cross-sell-choices" role="group" aria-labelledby={id + '-moments'} aria-describedby={id + '-moments-hint'} aria-invalid={!!error('moments')}>
                {vm.visibleTouchpoints.map(tp => <CrossSellChoice key={tp} type="checkbox"
                  checked={!!config.touchpoints[tp]} onChange={() => vm.toggleTouchpoint(tp)}
                  title={MOMENTS[tp][0]} description={MOMENTS[tp][1]} />)}
              </div>
              {error('moments') && <p className="form-field-error" role="alert">{error('moments')}</p>}
            </section>
            <section className="configuration-form__section" aria-labelledby={id + '-strategy'}>
              <h3 id={id + '-strategy'}>Como escolher os produtos</h3><p id={id + '-strategy-hint'}>Escolha uma única fonte para as recomendações, usada em todos os momentos selecionados.</p>
              <div className="cross-sell-choices" role="radiogroup" aria-labelledby={id + '-strategy'} aria-describedby={id + '-strategy-hint'} aria-invalid={!!error('strategy')}>
                {(Object.keys(STRATEGIES) as CrossSellStrategy[]).map(strategy => <CrossSellChoice key={strategy} type="radio"
                  name={id + '-strategy'} checked={config.strategies[0] === strategy} onChange={() => vm.selectStrategy(strategy)}
                  title={STRATEGIES[strategy][0]} description={STRATEGIES[strategy][1]} />)}
              </div>
              {error('strategy') && <p className="form-field-error" role="alert">{error('strategy')}</p>}
            </section>
            <section className="configuration-form__section">
              <h3>Frequência e apresentação</h3>
              <div className="configuration-form__grid">
                <FormField label="Máximo de sugestões por sessão" type="number" value={String(config.limits.maxSuggestionsPerSession || '')} onChange={value => vm.patchConfig({ limits: { ...config.limits, maxSuggestionsPerSession: Number(value) } })} inputProps={{ min: 1, max: 5 }} hint="De 1 a 5 sugestões durante a visita." error={error('max')} />
                <FormField label="Intervalo entre sugestões (segundos)" type="number" value={String(config.limits.cooldownSeconds || '')} onChange={value => vm.patchConfig({ limits: { ...config.limits, cooldownSeconds: Number(value) } })} inputProps={{ min: 30, max: 600 }} hint="De 30 a 600 segundos." error={error('cooldown')} />
              </div>
              <FormSelect label="Apresentação da sugestão" value={config.display.mode} onChange={value => vm.patchConfig({ display: { mode: value as CrossSellDisplayMode } })} options={DISPLAY} />
            </section>
            <section className="configuration-form__section">
              <div className="cross-sell-switch"><div><label htmlFor={id + '-discount'}>Oferecer desconto</label><p>Incentivo opcional para o produto sugerido.</p></div><ToggleSwitch id={id + '-discount'} checked={config.discount.enabled} disabled={saving} onChange={enabled => vm.patchConfig({ discount: { ...config.discount, enabled } })} /></div>
              {config.discount.enabled && <div className="configuration-form__grid">
                <FormSelect label="Tipo de incentivo" value={config.discount.mode ?? "percent"} onChange={mode => vm.patchConfig({ discount: { ...config.discount, mode: mode as "percent" | "coupon" } })} options={[{ value: "percent", label: "Desconto percentual" }, { value: "coupon", label: "Cupom da loja" }]} />
                {(config.discount.mode ?? "percent") === "percent" ? <FormField label="Desconto (%)" type="number" value={String(config.discount.percent || '')} onChange={value => vm.patchConfig({ discount: { ...config.discount, percent: Number(value) } })} inputProps={{ min: 1, max: 50 }} hint="De 1% a 50%." error={error('percent')} /> :
                  <FormField label="Código do cupom" value={config.discount.couponCode ?? ''} onChange={value => vm.patchConfig({ discount: { ...config.discount, couponCode: value.trim().toUpperCase() } })} hint="Use um cupom ativo. Validade e condições do cupom continuam valendo." error={error('coupon')} />}
              </div>}
            </section>
          </>}
          <p role="status">{vm.dirty ? "Você tem alterações para salvar." : "Configurações sincronizadas com a loja."}</p>
        </fieldset>
      </form>}
  </div>;
}
