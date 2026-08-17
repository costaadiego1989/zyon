import React from "react";
import {
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Power,
  Bell,
  Minimize2,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from "lucide-react";
import type {
  CheckoutSettingsMode,
  CheckoutWidgetPosition,
} from "@zyon/shared-types";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import { useCheckoutSettingsPage } from "./useCheckoutSettingsPage.js";
import { SectionRail } from "./components/SectionRail.js";
import { SettingRow } from "./components/SettingRow.js";
import { ToggleSwitch } from "./components/ToggleSwitch.js";
import { SliderField } from "./components/SliderField.js";
import { NumberField } from "./components/NumberField.js";
import { ActivationFlow } from "./components/ActivationFlow.js";
import { TriggerCard } from "./components/TriggerCard.js";
import { RulesList } from "./components/RulesList.js";
import { RuleEditor } from "./components/RuleEditor.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { ALL_TRIGGERS, MODE_OPTIONS, PROGRESSIVE_PRESETS, TRIGGER_STATUS } from "./lib/constants.js";
import type { Draft } from "./lib/draft.js";
import "./checkout-settings-page.css";

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

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Configurações do Checkout</h1>
            <p className="page-lead">
              Login necessário para acessar as configurações de checkout.
            </p>
          </div>
        </header>
      </div>
    );
  }

  const hasErrors = Object.keys(vm.errors).length > 0;
  const activeTriggers = vm.draft ? ALL_TRIGGERS.filter((t) => vm.draft!.triggers[t].enabled && TRIGGER_STATUS[t] === "active").length : 0;
  const totalAvailableTriggers = ALL_TRIGGERS.filter((t) => TRIGGER_STATUS[t] === "active").length;
  const modeBadge =
    vm.draft?.mode === "silent_until_trigger"
      ? { cls: "ok", label: "trigger" }
      : vm.draft?.mode === "proactive"
      ? { cls: "warn", label: "proativo" }
      : { cls: "muted", label: "manual" };

  return (
    <div className="dashboard-content cfg-page">
      {/* ── Page Head ── */}
      <header className="page-head cfg-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Configurações do Checkout</h1>
          <p className="page-lead">
            Defina quando e como o agente entra em ação durante a compra.
          </p>
        </div>
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
            disabled={vm.busy || !vm.draft || hasErrors || !vm.dirty}
            onClick={() => vm.save()}
            loading={vm.busy}
          >
            <Save size={14} strokeWidth={2} />
            Salvar
          </Button>
        </div>
      </header>

      {/* ── Messages ── */}
      {vm.message ? (
        <div className={`cfg-banner ${vm.message.kind === "error" ? "err" : "info"}`} role="status">
          {vm.message.kind === "error" ? (
            <AlertTriangle size={16} strokeWidth={1.75} />
          ) : (
            <CheckCircle2 size={16} strokeWidth={1.75} />
          )}
          <span>{vm.message.text}</span>
        </div>
      ) : null}

      {/* ── Loading ── */}
      {!vm.settings && !vm.message ? <SettingsSkeleton /> : null}

      {/* ── Content ── */}
      {vm.draft ? (
        <div className="cfg-controls">
          {/* ── Activation flow diagram ── */}
          <div className="cfg-flow-card">
            <div className="cfg-flow-card-head">
              <div className="cfg-flow-title">
                <Activity size={15} strokeWidth={1.75} />
                <span>Como o agente entra em ação</span>
              </div>
              <span className={`badge ${modeBadge.cls}`}>{modeBadge.label}</span>
            </div>
            <ActivationFlow draft={vm.draft} />
          </div>

          {/* Tabs */}
          <TabBar
            tabs={[
              { key: "behavior", label: "Aparência" },
              { key: "triggers", label: "Sinais & Limites" },
              { key: "discounts", label: "Descontos" },
              { key: "rules", label: "Regras" },
            ]}
            activeTab={vm.activeTab}
            onTabChange={(k) => vm.setActiveTab(k as "behavior" | "triggers" | "discounts" | "rules")}
          />

          <div className="cfg-panel">

            {vm.activeTab === "behavior" && <>
            {/* 1 — Activation */}
            <SectionRail
              icon={<Power size={16} strokeWidth={1.75} />}
              index="01"
              title="Como ativa"
              desc="Escolha se o agente age sozinho ou espera um sinal."
            >
              <fieldset className="cfg-modes">
                <legend className="sr-only">Modo de ativação</legend>
                {MODE_OPTIONS.map(({ value, label, desc, iconName, isDefault }) => {
                  const selected = vm.draft!.mode === value;
                  const iconMap: Record<string, React.ReactNode> = {
                    Radio: <Power size={16} strokeWidth={1.75} />,
                    Eye: <Eye size={16} strokeWidth={1.75} />,
                    EyeOff: <EyeOff size={16} strokeWidth={1.75} />,
                  };
                  return (
                    <label
                      key={value}
                      className={`cfg-mode${selected ? " selected" : ""}`}
                      data-disabled={vm.busy ? "true" : undefined}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={value}
                        checked={selected}
                        disabled={vm.busy}
                        onChange={() => vm.patchDraft({ mode: value as CheckoutSettingsMode })}
                      />
                      <span className="cfg-mode-icon">{iconMap[iconName]}</span>
                      <span className="cfg-mode-text">
                        <span className="cfg-mode-label">
                          {label}
                          {isDefault ? <span className="cfg-tag">padrão</span> : null}
                        </span>
                        <span className="cfg-mode-desc">{desc}</span>
                      </span>
                      <span className="cfg-mode-check" aria-hidden="true">
                        <CheckCircle2 size={16} strokeWidth={2} />
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </SectionRail>

            {/* 2 — Behavior */}
            <SectionRail
              icon={<Minimize2 size={16} strokeWidth={1.75} />}
              index="02"
              title="Como aparece"
              desc="Onde e como o widget mostra para o comprador."
            >
              <div className="cfg-rows">
                <SettingRow
                  id="toggle-open-widget"
                  title="Abrir ao ativar"
                  desc="Abre sozinho quando o agente age."
                  control={
                    <ToggleSwitch
                      id="toggle-open-widget"
                      checked={vm.draft!.openWidgetOnTrigger}
                      disabled={vm.busy}
                      onChange={(v) => vm.patchDraft({ openWidgetOnTrigger: v })}
                    />
                  }
                />
                <SettingRow
                  id="toggle-minimized"
                  title="Começar fechado"
                  desc="Widget inicia recolhido no canto."
                  control={
                    <ToggleSwitch
                      id="toggle-minimized"
                      checked={vm.draft!.startMinimized}
                      disabled={vm.busy}
                      onChange={(v) => vm.patchDraft({ startMinimized: v })}
                    />
                  }
                />
              </div>

              <div className="cfg-grid-2">
                <div className="cfg-field">
                  <label htmlFor="cfg-position">Posição na tela</label>
                  <div className="cfg-select">
                    <select
                      id="cfg-position"
                      value={vm.draft!.position}
                      disabled={vm.busy}
                      onChange={(e) =>
                        vm.patchDraft({ position: e.target.value as CheckoutWidgetPosition })
                      }
                    >
                      <option value="bottom_right">Canto inferior direito</option>
                      <option value="bottom_left">Canto inferior esquerdo</option>
                    </select>
                  </div>
                </div>

                <SliderField
                  label="Espera inicial"
                  help="Tempo antes do agente abrir o chat no modo Iniciar sozinho."
                  value={vm.draft!.initialDelaySeconds}
                  min={0}
                  max={30}
                  step={1}
                  disabled={vm.busy}
                  display={`${vm.draft!.initialDelaySeconds}s`}
                  onChange={(v) => vm.patchDraft({ initialDelaySeconds: v })}
                />
              </div>
            </SectionRail>

            {/* 3 — URL de retorno */}
            <SectionRail
              icon={<Activity size={16} strokeWidth={1.75} />}
              index="03"
              title="Navegação"
              desc="Configure o comportamento de retorno do checkout."
            >
              <div className="cfg-field">
                <FormField
                  label="URL de retorno"
                  type="url"
                  placeholder="https://seusite.com"
                  value={vm.draft!.checkoutReturnUrl ?? ""}
                  disabled={vm.busy}
                  onChange={(v) => vm.patchDraft({ checkoutReturnUrl: v })}
                  hint='Quando o comprador clicar em "voltar" no checkout, será redirecionado para esta URL.'
                />
              </div>
            </SectionRail>
            </>}

            {vm.activeTab === "triggers" && <>
            {/* 4 — Triggers */}
            <SectionRail
              icon={<Bell size={16} strokeWidth={1.75} />}
              index="03"
              title="Sinais do comprador"
              desc="Momentos em que o agente pode intervir automaticamente."
              aside={
                <span className={`badge ${activeTriggers > 0 ? "ok" : "muted"}`}>
                  {activeTriggers}/{totalAvailableTriggers} ligados
                </span>
              }
            >
              <div className="cfg-triggers">
                {ALL_TRIGGERS.map((t) => (
                  <TriggerCard
                    key={t}
                    trigger={t}
                    enabled={vm.draft!.triggers[t].enabled}
                    busy={vm.busy}
                    onChange={(v) => vm.patchTrigger(t, { enabled: v })}
                  />
                ))}
              </div>
            </SectionRail>

            {/* 4 — Limits */}
            <SectionRail
              icon={<Timer size={16} strokeWidth={1.75} />}
              index="04"
              title="Limites"
              desc="Controla a frequência para o agente não ser insistente."
              aside={hasErrors ? <span className="badge bad">erros</span> : undefined}
            >
              <div className="cfg-grid-2">
                <NumberField
                  label="Espera entre ações"
                  help={`Agente espera ${(vm.draft!.cooldownSeconds / 60).toFixed(1)} min antes de agir de novo.`}
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
              index="05"
              title="Desconto progressivo"
              desc="Oferece mais desconto conforme o risco de perda aumenta. O motor de regras ainda valida o teto e a margem."
              aside={
                <span className={`badge ${vm.draft!.progressiveDiscountEnabled ? "ok" : "muted"}`}>
                  {vm.draft!.progressiveDiscountEnabled ? "ligado" : "desligado"}
                </span>
              }
            >
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

              <div className="cfg-preset-buttons">
                <span className="cfg-preset-label">Presets:</span>
                <button
                  type="button"
                  className={`cfg-preset-btn${vm.draft!.progressiveLevel === "conservative" ? " active" : ""}`}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveLevel: "conservative",
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
                  className={`cfg-preset-btn${vm.draft!.progressiveLevel === "moderate" ? " active" : ""}`}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveLevel: "moderate",
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
                  className={`cfg-preset-btn${vm.draft!.progressiveLevel === "aggressive" ? " active" : ""}`}
                  disabled={vm.busy || !vm.draft!.progressiveDiscountEnabled}
                  onClick={() => vm.patchDraft({
                    progressiveLevel: "aggressive",
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
            <SectionRail
              icon={<Activity size={16} strokeWidth={1.75} />}
              index="06"
              title="Regras avançadas"
              desc="Defina regras customizadas para que o agente siga durante o checkout."
              aside={
                <span className={`badge ${vm.draft!.advancedRules.length > 0 ? "ok" : "muted"}`}>
                  {vm.draft!.advancedRules.length} {vm.draft!.advancedRules.length === 1 ? "regra" : "regras"}
                </span>
              }
            >
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
            </>}

            {vm.editorOpen && (
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
            )}

            {/* Footer actions */}
            <div className="cfg-footer">
              <div className="cfg-footer-left">
                <Button
                  variant="ghost"
                  disabled={vm.busy}
                  onClick={() => vm.restoreDefaults()}
                >
                  <RotateCcw size={14} strokeWidth={1.75} />
                  Restaurar padrão
                </Button>
                {vm.dirty ? (
                  <Button
                    variant="ghost"
                    disabled={vm.busy}
                    onClick={() => vm.discardChanges()}
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
