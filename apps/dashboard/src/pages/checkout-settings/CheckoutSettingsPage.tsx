import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import React from "react";
import { useState } from "react";
import {
  Save,
  RotateCcw,
  Bell,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Activity,
  MessageCircle,
} from "lucide-react";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import { useCheckoutSettingsPage } from "./useCheckoutSettingsPage.js";
import { SectionRail } from "./components/SectionRail.js";
import { SettingRow } from "./components/SettingRow.js";
import { ToggleSwitch } from "./components/ToggleSwitch.js";
import { NumberField } from "./components/NumberField.js";
import { TriggerCard } from "./components/TriggerCard.js";
import { TriggerEditor } from "./components/TriggerEditor.js";
import { RulesList } from "./components/RulesList.js";
import { RuleEditor } from "./components/RuleEditor.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { ALL_TRIGGERS, TRIGGER_STATUS } from "./lib/constants.js";
import "./checkout-settings-page.css";
import "./checkout-refinements.css";

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="split-panel">
      <div className="split-panel-controls">
        <div className="skeleton" style={{ height: 118, borderRadius: "var(--radius-lg)" }} />
        {[210, 250, 300, 220].map((h, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: h, borderRadius: "var(--radius-md)" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div className="skeleton" style={{ height: 480, borderRadius: "var(--radius-md)" }} />
      </div>
    </div>
  );
}

// ── Page Component ───────────────────────────────────────────────────────────

export function CheckoutSettingsPage(props: {
  apiBaseUrl: string;
  me: MerchantMeProfile | null;
}) {
  const vm = useCheckoutSettingsPage({ me: props.me });
  const [editingTrigger, setEditingTrigger] = useState<import("@zyon/shared-types").CheckoutTriggerName | null>(null);

  const [confirmation, setConfirmation] = useState<"reload" | "defaults" | "discard" | null>(null);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <PageHeader title="Checkout" description="Login necessário para acessar as configurações de checkout." />
      </div>
    );
  }

  const hasErrors = Object.keys(vm.errors).length > 0;
  const activeTriggers = vm.draft ? ALL_TRIGGERS.filter((t) => vm.draft!.triggers[t].enabled && TRIGGER_STATUS[t] === "active").length : 0;
  const totalAvailableTriggers = ALL_TRIGGERS.filter((t) => TRIGGER_STATUS[t] === "active").length;

  return (
    <div className="dashboard-content cfg-page">
      {/* ── Page Head ── */}
      <PageHeader title="Checkout" description="Defina quando e como o agente entra em ação durante a compra." actions={<>
<div className="cfg-head-actions">
          {vm.dirty ? (
            <span className="cfg-dirty-pill" aria-live="polite">
              <span className="cfg-dirty-dot" />
              Mudanças pendentes
            </span>
          ) : null}
          <Button
            variant="primary"
            arrow
            className="cfg-save"
            disabled={vm.busy || !vm.settings || vm.reloadRequired || !vm.draft || hasErrors || !vm.dirty}
            onClick={() => vm.save()}
            loading={vm.busy}
          >
            <Save size={14} strokeWidth={2} />
            Salvar configurações
          </Button>
        </div>
</>} />
      <SetupGuide title="Como configurar a atuação no checkout" steps={[{"title":"Defina quando ajudar","description":"Revise os sinais que permitem uma intervenção e os momentos em que o agente deve aguardar."},{"title":"Estabeleça limites","description":"Confira a frequência das intervenções, os descontos permitidos e as regras adicionais. Uma regra mais restritiva pode limitar a oferta."},{"title":"Salve e confira a experiência","description":"O botão Salvar configurações aplica as mudanças de todas as abas. Depois, revise o checkout da loja. Ajuste as condições antes de disponibilizar uma nova estratégia."}]} />

      {/* ── Messages ── */}
      {vm.message ? (
        <div className={`cfg-banner ${vm.message.kind === "error" ? "err" : "info"}`} role={vm.message.kind === "error" ? "alert" : "status"}>
          {vm.message.kind === "error" ? (
            <AlertTriangle size={16} strokeWidth={1.75} />
          ) : (
            <CheckCircle2 size={16} strokeWidth={1.75} />
          )}
          <span>{vm.message.text}</span>
          {vm.reloadRequired || !vm.settings ? (
            <Button
              variant="outline"
              size="sm"
              disabled={vm.busy}
              onClick={() => vm.dirty ? setConfirmation("reload") : vm.load()}
            >
              Recarregar configurações
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ── Loading ── */}
      {!vm.settings && !vm.message ? <SettingsSkeleton /> : null}

      {hasErrors && <div className="cfg-banner err" role="alert"><span>Revise os campos com erro antes de salvar.</span><Button variant="outline" size="sm" onClick={() => vm.setActiveTab("triggers")}>Revisar limites</Button></div>}
      <ConfirmDialog open={confirmation !== null} variant="default" title={confirmation === "defaults" ? "Restaurar configuração padrão?" : confirmation === "reload" ? "Recarregar configurações?" : "Descartar mudanças?"} description={confirmation === "defaults" ? "O rascunho de todas as abas será substituído pelos valores padrão. Revise e salve para aplicar." : "As mudanças ainda não salvas serão descartadas. A configuração salva na loja será mantida."} confirmLabel={confirmation === "defaults" ? "Restaurar rascunho" : confirmation === "reload" ? "Descartar e recarregar" : "Descartar mudanças"} onCancel={() => setConfirmation(null)} onConfirm={() => { if (confirmation === "defaults") vm.restoreDefaults(); else if (confirmation === "reload") vm.load(); else vm.discardChanges(); setConfirmation(null); }} />
      {/* ── Content ── */}
      {vm.draft ? (
        <div className="cfg-controls">

          {/* Tabs */}
          <TabBar
            tabs={[
              { key: "triggers", label: "Quando ajudar" },
              { key: "discounts", label: "Descontos" },
              { key: "rules", label: "Regras avançadas" },
            ]}
            activeTab={vm.activeTab}
            onTabChange={(k) => vm.setActiveTab(k as "triggers" | "discounts" | "rules")}
          />

          <div className="cfg-panel">

            {vm.activeTab === "triggers" && <>
            {/* 4 — Triggers */}
            <SectionRail
              icon={<Bell size={16} strokeWidth={1.75} />}
              index="02"
              title="Sinais do comprador"
              desc="Momentos em que o agente pode intervir automaticamente."
              aside={
                <span className={`badge ${activeTriggers > 0 ? "ok" : "muted"}`}>
                  {activeTriggers}/{totalAvailableTriggers} ativos
                </span>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ALL_TRIGGERS.map((t) => (
                  <TriggerCard
                    key={t}
                    trigger={t}
                    idleSeconds={vm.draft!.idleSeconds}
                    enabled={vm.draft!.triggers[t].enabled}
                    busy={vm.busy}
                    onChange={(v) => vm.patchTrigger(t, { enabled: v })}
                    onConfigure={() => setEditingTrigger(t)}
                  />
                ))}
              </div>
            </SectionRail>

            {/* 4 — Limits */}
            <SectionRail icon={<MessageCircle size={16} strokeWidth={1.75} />} index="02"
              title="Ajuda durante a compra" desc="Respostas e ações para destravar a etapa em que o comprador está.">
              <div className="cfg-rows">
                {([
                  ["pix", "Pix pendente ou expirado", "Ajuda a consultar a confirmação, reencontrar o código ou renovar um Pix expirado."],
                  ["installments", "Dúvidas sobre parcelamento", "Explica as condições disponíveis e direciona ao pagamento seguro com cartão."],
                  ["unavailableProduct", "Produto indisponível", "Explica a falta de estoque e consulta alternativas disponíveis na loja."],
                  ["humanHandoff", "Dificuldade persistente", "Após duas tentativas sem solução, oferece atendimento humano. O comprador escolhe se quer chamar a equipe."],
                ] as const).map(([key, title, desc]) => <SettingRow key={key} id={`help-${key}`} title={title} desc={desc}
                  control={<ToggleSwitch id={`help-${key}`} checked={vm.draft!.assistance[key]} disabled={vm.busy}
                    onChange={enabled => vm.patchDraft({ assistance: { ...vm.draft!.assistance, [key]: enabled } })} />} />)}
              </div>
            </SectionRail>

            <SectionRail
              icon={<Timer size={16} strokeWidth={1.75} />}
              index="03"
              title="Limites"
              desc="Controla a frequência para o agente não ser insistente."
              aside={hasErrors ? <span className="badge bad">erros</span> : undefined}
            >
              <div className="cfg-grid-2">
                <NumberField
                  label="Espera entre ações"
                  help={`Agente espera ${((Number.isFinite(vm.draft!.cooldownSeconds) ? vm.draft!.cooldownSeconds : 90) / 60).toFixed(1)} min antes de agir de novo.`}
                  value={vm.draft!.cooldownSeconds}
                  min={30}
                  disabled={vm.busy}
                  suffix="s"
                  onChange={(v) => vm.patchDraft({ cooldownSeconds: v })}
                  error={vm.errors.cooldownSeconds}
                />
                <NumberField
                  label="Máximo por visita"
                  help="Quantas vezes o agente pode iniciar contato na mesma sessão."
                  value={vm.draft!.maxInterventionsPerSession}
                  min={1}
                  max={10}
                  disabled={vm.busy}
                  onChange={(v) => vm.patchDraft({ maxInterventionsPerSession: v })}
                  error={vm.errors.maxInterventionsPerSession}
                />
              </div>
            </SectionRail>
            </>}

            {vm.activeTab === "discounts" && <>
            {/* 5 — Progressive discount */}
            <SectionRail
              icon={<Activity size={16} strokeWidth={1.75} />}
              index="04"
              title="Desconto progressivo"
              desc="Oferece mais desconto conforme o risco de perda aumenta. O motor de regras ainda valida o teto e a margem."
              aside={
                <span className={`badge ${vm.draft!.progressiveDiscountEnabled ? "ok" : "muted"}`}>
                  {vm.draft!.progressiveDiscountEnabled ? "ligado" : "desligado"}
                </span>
              }
            >
              {(() => {
                const hasCommercialRule = vm.draft!.advancedRules.some(
                  (r) => r.enabled && (r.action?.type === "offer_discount" || r.action?.type === "offer_free_shipping")
                );
                if (!vm.draft!.progressiveDiscountEnabled || !hasCommercialRule) return null;
                return (
                  <div className="cfg-priority-note" role="note" data-priority="rules-over-progressive">
                    <strong>Aviso:</strong> Você tem regras avançadas de desconto/frete ativas. Quando aplicáveis, elas têm prioridade. Se uma regra já aplicou desconto, este desconto progressivo <strong>não acumula</strong>. O motor de regras sempre respeita o teto e a margem.
                  </div>
                );
              })()}
              <div className="cfg-rows">
                <SettingRow
                  id="toggle-progressive-discount"
                  title="Ativar desconto progressivo"
                  desc="Começa com pouco e aumenta quando o comprador mostra risco de sair."
                  control={
                    <ToggleSwitch
                      id="toggle-progressive-discount"
                      checked={vm.draft!.progressiveDiscountEnabled}
                      disabled={vm.busy}
                      onChange={(v) => vm.patchDraft({ progressiveDiscountEnabled: v })}
                    />
                  }
                />
              </div>

              <div className="cfg-progressive-max" data-disabled={vm.draft!.progressiveDiscountEnabled ? undefined : "true"}>
                <NumberField
                  label="Teto geral do desconto progressivo"
                  help="Limite máximo que qualquer etapa do progressivo pode oferecer. O motor de regras ainda respeita a margem mínima."
                  value={vm.draft!.progressiveMaxPercent}
                  min={5}
                  max={100}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  suffix="%"
                  onChange={(v) => vm.patchDraft({ progressiveMaxPercent: v })}
                />
              </div>

              <div className="cfg-preset-buttons">
                <span className="cfg-preset-label">Sugestões:</span>
                <button
                  type="button"
                  className="cfg-preset-btn"
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveInitialCouponPercent: 5,
                    progressiveExitIntentPercent: 7,
                    progressiveAbandonedCartPercent: 10,
                    progressivePaymentNudgePercent: 5,
                  })}
                >
                  Conservador
                </button>
                <button
                  type="button"
                  className="cfg-preset-btn"
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveInitialCouponPercent: 7,
                    progressiveExitIntentPercent: 10,
                    progressiveAbandonedCartPercent: 15,
                    progressivePaymentNudgePercent: 7,
                  })}
                >
                  Moderado
                </button>
                <button
                  type="button"
                  className="cfg-preset-btn"
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveInitialCouponPercent: 10,
                    progressiveExitIntentPercent: 15,
                    progressiveAbandonedCartPercent: 20,
                    progressivePaymentNudgePercent: 10,
                  })}
                >
                  Agressivo
                </button>
              </div>

              <div className="cfg-progressive-grid" data-disabled={vm.draft!.progressiveDiscountEnabled ? undefined : "true"}>
                <NumberField
                  label="No cupom"
                  help="Quando o comprador abre o campo de cupom."
                  value={vm.draft!.progressiveInitialCouponPercent}
                  min={0}
                  max={100}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  suffix="%"
                  onChange={(v) => vm.patchDraft({ progressiveInitialCouponPercent: v })}
                />
                <NumberField
                  label="Ao tentar sair"
                  help="Quando o cursor sai da página."
                  value={vm.draft!.progressiveExitIntentPercent}
                  min={0}
                  max={100}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  suffix="%"
                  onChange={(v) => vm.patchDraft({ progressiveExitIntentPercent: v })}
                />
                <NumberField
                  label="Carrinho abandonado"
                  help="Recuperação depois do abandono."
                  value={vm.draft!.progressiveAbandonedCartPercent}
                  min={0}
                  max={100}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  suffix="%"
                  onChange={(v) => vm.patchDraft({ progressiveAbandonedCartPercent: v })}
                />
                <NumberField
                  label="Na hora de pagar"
                  help="Última oferta antes do pagamento."
                  value={vm.draft!.progressivePaymentNudgePercent}
                  min={0}
                  max={100}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  suffix="%"
                  onChange={(v) => vm.patchDraft({ progressivePaymentNudgePercent: v })}
                />
              </div>
              <p className="cfg-help">
                Cada valor é o desconto total daquela etapa, não a soma. O motor de regras aplica o teto e a margem mínima.
              </p>
            </SectionRail>
            </>}

            {vm.activeTab === "rules" && <>
            <SectionErrorBoundary sectionName="Regras avançadas">
            <SectionRail
              icon={<Activity size={16} strokeWidth={1.75} />}
              index="05"
              title="Regras avançadas"
              desc="Defina regras customizadas para que o agente siga durante o checkout."
              aside={
                <span className={`badge ${vm.draft!.advancedRules.length > 0 ? "ok" : "muted"}`}>
                  {vm.draft!.advancedRules.length} {vm.draft!.advancedRules.length === 1 ? "regra" : "regras"}
                </span>
              }
            >
              {vm.draft!.progressiveDiscountEnabled && (
                <div className="cfg-help" role="note" data-priority="advanced-over-progressive">
                  <strong>Prioridade:</strong> Uma regra avançada aplicável tem prioridade. O desconto progressivo é considerado quando nenhuma regra prioritária se aplica. Os descontos não são somados.
                </div>
              )}
              <RulesList
                rules={vm.draft!.advancedRules}
                busy={vm.busy}
                onAdd={() => vm.openRuleEditor(null)}
                onEdit={(id) => {
                  const rule = vm.draft!.advancedRules.find((r) => r.id === id);
                  if (rule) vm.openRuleEditor(rule);
                }}
                onDelete={(id) => vm.deleteRule(id)}
                onToggle={(id, enabled) => vm.toggleRule(id, enabled)}
                onReorder={(rules) => vm.reorderRules(rules)}
              />
            </SectionRail>
            </SectionErrorBoundary>
            </>}

            {vm.editorOpen && (
              <SectionErrorBoundary sectionName="Editor de Regras">
              <RuleEditor
                rule={vm.editingRule}
                onSave={(rule) => {
                  if (vm.editingRule?.id === rule.id) {
                    vm.updateRule(rule.id, rule);
                  } else {
                    vm.addRule(rule);
                  }
                }}
                onCancel={() => vm.closeRuleEditor()}
                busy={vm.busy}
              />
              </SectionErrorBoundary>
            )}

            {editingTrigger && vm.draft && (
              <TriggerEditor
                trigger={editingTrigger}
                idleSeconds={vm.draft.idleSeconds}
                message={vm.draft.triggers[editingTrigger].message}
                couponCode={vm.draft.triggers[editingTrigger].couponCode}
                onSave={({ idleSeconds, ...data }) => {
                  vm.patchTrigger(editingTrigger, data);
                  if (idleSeconds !== undefined) vm.patchDraft({ idleSeconds });
                  setEditingTrigger(null);
                }}
                onCancel={() => setEditingTrigger(null)}
                busy={vm.busy}
              />
            )}

            {/* Footer actions */}
            <div className="cfg-footer">
              <div className="cfg-footer-left">
                <Button
                  variant="ghost"
                  disabled={vm.busy}
                  onClick={() => setConfirmation("defaults")}
                >
                  <RotateCcw size={14} strokeWidth={1.75} />
                  Restaurar padrão
                </Button>
                {vm.dirty ? (
                  <Button
                    variant="ghost"
                    disabled={vm.busy}
                    onClick={() => setConfirmation("discard")}
                  >
                    Descartar mudanças
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
