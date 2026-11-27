import React, { useId, useState } from "react";
import {
  marketingStages,
  marketingStageLabels,
  type MarketingCampaignDraft,
  type MarketingCampaign,
  type MarketingStage,
  type MarketingContact,
} from "../../api/marketing.js";
import { Button } from "../../components/Button.js";
import { SidePanel } from "../../components/SidePanel.js";
import { marketingCents } from "./marketing-format.js";

export function CampaignEditor({
  campaign,
  busy,
  saveError,
  onSave,
  onCancel,
}: {
  campaign?: MarketingCampaign;
  busy: boolean;
  saveError?: string;
  onSave: (draft: MarketingCampaignDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const messageFieldId = useId();
  const formId = useId();
  const [name, setName] = useState(campaign?.name ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [stage, setStage] = useState(campaign?.segment.stage ?? "");
  const [origin, setOrigin] = useState(campaign?.segment.origin ?? "");
  const [buyer, setBuyer] = useState(campaign?.segment.buyer ?? "");
  const [interest, setInterest] = useState(campaign?.segment.interest ?? "");
  const [budget, setBudget] = useState(
    campaign ? (campaign.budgetCents / 100).toFixed(2).replace(".", ",") : ""
  );
  const [unit, setUnit] = useState(
    campaign
      ? (campaign.maxUnitCostCents / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const budgetCents = marketingCents(budget),
      maxUnitCostCents = marketingCents(unit);
    if (!budgetCents || !maxUnitCostCents) {
      setError(
        "Informe valores positivos em reais, com até duas casas decimais, sem separador de milhar."
      );
      return;
    }
    if (body.includes("{{")) {
      setError(
        "Use uma mensagem fixa para este público, sem campos de personalização."
      );
      return;
    }
    setError("");
    await onSave({
      name: name.trim(),
      body: body.trim(),
      budgetCents,
      maxUnitCostCents,
      language: campaign?.language ?? "pt_BR",
      segment: {
        ...(stage ? { stage: stage as MarketingStage } : {}),
        ...(origin ? { origin: origin as MarketingContact["origin"] } : {}),
        ...(buyer ? { buyer: buyer as "lead" | "customer" } : {}),
        ...(interest.trim() ? { interest: interest.trim() } : {}),
      },
    });
  };
  return (
    <SidePanel
      isOpen
      title={campaign ? "Editar campanha" : "Nova campanha"}
      subtitle="Defina a mensagem e o público. O envio depende de revisão e aprovação."
      onClose={() => {
        if (!busy) onCancel();
      }}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            Salvar rascunho
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="marketing-form marketing-drawer-form"
        onSubmit={submit}
        aria-busy={busy}
      >
        {campaign?.approvedVersion && (
          <p className="marketing-help">
            Salvar alterações remove a aprovação anterior. Você precisará
            revisar e aprovar a nova versão.
          </p>
        )}
        {(error || saveError) && (
          <p role="alert" className="marketing-notice">
            {error || saveError}
          </p>
        )}
        <label>
          Nome da campanha
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Novidades da semana"
          />
        </label>
        <div className="marketing-field">
          <label htmlFor={messageFieldId}>Mensagem</label>
          <textarea
            id={messageFieldId}
            required
            maxLength={1024}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Apresente a novidade, as condições e como pedir para não receber promoções."
          />
        </div>
        <p className="marketing-help">
          Esta mensagem será a mesma para todo o público. Recomendamos incluir:
          “Para não receber promoções, responda PARAR”.
        </p>
        <fieldset className="marketing-fieldset">
          <legend>Público</legend>
          <label>
            Etapa do funil
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value as typeof stage)}
            >
              <option value="">Todas as etapas</option>
              {marketingStages.map((value) => (
                <option key={value} value={value}>
                  {marketingStageLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Origem do contato
            <select
              value={origin}
              onChange={(event) =>
                setOrigin(event.target.value as typeof origin)
              }
            >
              <option value="">Todas as origens</option>
              <option value="site">Site</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="unknown">Não identificada</option>
            </select>
          </label>
          <label>
            Tipo de contato
            <select
              value={buyer}
              onChange={(event) => setBuyer(event.target.value as typeof buyer)}
            >
              <option value="">Leads e compradores</option>
              <option value="lead">Leads</option>
              <option value="customer">Compradores</option>
            </select>
          </label>
          <label>
            Interesse conhecido
            <input
              maxLength={120}
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              placeholder="Ex.: Tênis"
            />
          </label>
        </fieldset>
        <fieldset className="marketing-fieldset">
          <legend>Estimativa de custos</legend>
          <label>
            Limite estimado da campanha (R$)
            <input
              required
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="Ex.: 100,00"
            />
          </label>
          <label>
            Custo estimado por mensagem (R$)
            <input
              required
              inputMode="decimal"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="Informe uma estimativa conservadora"
            />
          </label>
        </fieldset>
        <p className="marketing-help">
          Templates promocionais podem ter cobrança da Meta por mensagem
          entregue, além de eventuais tarifas do provedor. Informe uma
          estimativa conforme as tarifas da sua conta. O sistema limita os
          envios usando esses valores; não consulta a cobrança real nem define
          um teto na conta Meta. Salvar o rascunho não envia mensagens.{" "}
          <a
            href="https://business.whatsapp.com/products/platform-pricing"
            target="_blank"
            rel="noreferrer"
          >
            Consultar tarifas do WhatsApp
          </a>
          .
        </p>
      </form>
    </SidePanel>
  );
}
