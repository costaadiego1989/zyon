import React, { useEffect, useId, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { useNegotiationPolicyPage } from "./useNegotiationPolicyPage.js";
import "../../components/configuration-form.css";
import "./negotiation-policy.css";
import { NegotiationHistory } from "./NegotiationHistory.js";

export interface NegotiationPolicyPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function NegotiationPolicyPage(props: NegotiationPolicyPageProps) {
  const vm = useNegotiationPolicyPage({ me: props.me });
  const id = useId();
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  useEffect(() => {
    setMin(String(vm.policy.min_discount_percent));
    setMax(String(vm.policy.max_discount_percent));
  }, [vm.policy]);
  const minValue = Number(min),
    maxValue = Number(max);
  const rangeError =
    min === "" || max === ""
      ? "Preencha os dois limites."
      : !Number.isFinite(minValue) ||
        !Number.isFinite(maxValue) ||
        minValue < 0 ||
        maxValue > 100 ||
        minValue > maxValue
      ? "Use valores de 0 a 100%, com o mínimo igual ou menor que o máximo."
      : "";
  const dirty =
    min === "" ||
    max === "" ||
    minValue !== vm.policy.min_discount_percent ||
    maxValue !== vm.policy.max_discount_percent ||
    vm.tempPolicy.negotiation_enabled !== vm.policy.negotiation_enabled;
  const cancel = () => {
    vm.handleCancelPolicy();
    setMin(String(vm.policy.min_discount_percent));
    setMax(String(vm.policy.max_discount_percent));
  };
  return (
    <div className="page-container negotiation-policy-page">
      <PageHeader
        title="Limites de negociação"
        description="Defina a faixa de desconto que sua loja permite em uma negociação."
      />
      {!props.me ? (
        <EmptyState
          title="Entre para configurar"
          description="Acesse sua conta para consultar os limites da loja."
        />
      ) : vm.loading ? (
        <PageLoader />
      ) : vm.loadError ? (
        <EmptyState
          title="Limites indisponíveis"
          description={vm.loadError}
          action={
            <Button variant="outline" onClick={vm.reload}>
              Tentar novamente
            </Button>
          }
        />
      ) : (
        <section className="panel negotiation-policy-form">
          <SectionHeader
            title="Condições permitidas"
            subtitle="A ativação e os limites só mudam na loja depois de salvar."
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!rangeError)
                void vm.handleSavePolicy({
                  ...vm.tempPolicy,
                  min_discount_percent: minValue,
                  max_discount_percent: maxValue,
                });
            }}
          >
            <fieldset className="configuration-form" disabled={vm.saving}>
              <div className="negotiation-policy-toggle">
                <label htmlFor={id}>
                  <strong>Permitir negociação</strong>
                  <span>
                    As ofertas continuam sujeitas às condições e aos limites
                    comerciais da loja.
                  </span>
                </label>
                <ToggleSwitch
                  id={id}
                  checked={vm.tempPolicy.negotiation_enabled}
                  disabled={vm.saving}
                  onChange={(value) =>
                    vm.setTempPolicy({
                      ...vm.tempPolicy,
                      negotiation_enabled: value,
                    })
                  }
                />
              </div>
              <div className="configuration-form__grid">
                <FormField
                  label="Desconto mínimo (%)"
                  type="number"
                  value={min}
                  onChange={setMin}
                  inputProps={{ min: 0, max: 100, step: "any", required: true }}
                  hint="Menor desconto permitido para uma oferta."
                />
                <FormField
                  label="Desconto máximo (%)"
                  type="number"
                  value={max}
                  onChange={setMax}
                  inputProps={{ min: 0, max: 100, step: "any", required: true }}
                  error={dirty ? rangeError : undefined}
                  hint="Teto de desconto permitido para uma oferta."
                />
              </div>
              <p className="configuration-form__note">
                Exemplo ilustrativo: em um produto de R$ 100, um teto de 5%
                permite até R$ 5 de desconto. Outras regras podem restringir a
                oferta.
              </p>
              <p>
                Quando uma negociação autoriza uma oferta, o desconto
                progressivo não é aplicado à mesma sessão. Regras específicas de
                produtos e categorias continuam preservadas.
              </p>
            </fieldset>
            {vm.saveError && (
              <p role="alert" className="negotiation-policy-error">
                {vm.saveError}
              </p>
            )}
            <div className="negotiation-policy-actions">
              <Button
                type="submit"
                loading={vm.saving}
                disabled={vm.saving || !dirty || !!rangeError}
              >
                Salvar limites
              </Button>
              {dirty && (
                <Button variant="ghost" disabled={vm.saving} onClick={cancel}>
                  Descartar alterações
                </Button>
              )}
              {dirty && <span role="status">Alterações ainda não salvas</span>}
            </div>
          </form>
        </section>
      )}
      {props.me && (
        <NegotiationHistory key={props.me.id} merchantId={props.me.id} />
      )}
    </div>
  );
}
