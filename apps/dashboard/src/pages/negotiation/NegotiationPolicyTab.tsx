import React, { useEffect, useState } from "react";
import { Save, RefreshCw, Sliders } from "lucide-react";
import type {
  NegotiationPolicy,
  NegotiationPolicyResponse,
  CategoryNegotiationPolicy,
  ItemNegotiationPolicy,
} from "../../api-client.js";
import { DashboardHttpError } from "../../api-client.js";

export type PolicyApi = {
  getNegotiationPolicy(): Promise<NegotiationPolicyResponse>;
  putNegotiationPolicy(payload: NegotiationPolicy): Promise<NegotiationPolicyResponse>;
};

function validatePolicy(p: NegotiationPolicy): Record<string, string> {
  const errors: Record<string, string> = {};

  if (p.global.minOfferDiscountPercent < 0)
    errors["global.min"] = "Mínimo deve ser >= 0";
  if (p.global.maxDiscountPercent < 0)
    errors["global.max"] = "Máximo deve ser >= 0";
  if (p.global.minOfferDiscountPercent > p.global.maxDiscountPercent)
    errors["global.range"] = "Mínimo não pode exceder máximo";
  if (p.global.maxDiscountPercent > 100)
    errors["global.max"] = "Máximo não pode exceder 100%";
  if (p.maxRounds < 1)
    errors["maxRounds"] = "Mínimo 1 rodada";
  if (p.estimatedCostPerAiCallCents < 0)
    errors["costPerCall"] = "Custo não pode ser negativo";
  if (p.maxAiCostCents !== undefined && p.maxAiCostCents <= 0)
    errors["maxAiCost"] = "Cap de custo deve ser > 0";

  for (let i = 0; i < (p.categories?.length ?? 0); i++) {
    const c = p.categories![i];
    if (!c.categoryId) errors[`cat.${i}.id`] = "ID obrigatório";
    if (c.minOfferDiscountPercent > c.maxDiscountPercent)
      errors[`cat.${i}.range`] = "Faixa inválida";
  }

  for (let i = 0; i < (p.items?.length ?? 0); i++) {
    const item = p.items![i];
    if (!item.sku) errors[`item.${i}.sku`] = "SKU obrigatório";
    if (item.minOfferDiscountPercent > item.maxDiscountPercent)
      errors[`item.${i}.range`] = "Faixa inválida";
  }

  return errors;
}

export { validatePolicy };

export function NegotiationPolicyTab({ api }: { api: PolicyApi }) {
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasCustomPolicy, setHasCustomPolicy] = useState(false);

  const [formEnabled, setFormEnabled] = useState(false);
  const [formGlobalMin, setFormGlobalMin] = useState(0);
  const [formGlobalMax, setFormGlobalMax] = useState(10);
  const [formMaxRounds, setFormMaxRounds] = useState(1);
  const [formMaxAiCost, setFormMaxAiCost] = useState<number | undefined>(undefined);
  const [formCostPerCall, setFormCostPerCall] = useState(1);
  const [formCategories, setFormCategories] = useState<CategoryNegotiationPolicy[]>([]);
  const [formItems, setFormItems] = useState<ItemNegotiationPolicy[]>([]);

  const [jsonMode, setJsonMode] = useState(false);
  const [policyJson, setPolicyJson] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadPolicy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function populateForm(policy: NegotiationPolicy) {
    setFormEnabled(policy.enabled);
    setFormGlobalMin(policy.global.minOfferDiscountPercent);
    setFormGlobalMax(policy.global.maxDiscountPercent);
    setFormMaxRounds(policy.maxRounds);
    setFormMaxAiCost(policy.maxAiCostCents);
    setFormCostPerCall(policy.estimatedCostPerAiCallCents);
    setFormCategories(policy.categories ?? []);
    setFormItems(policy.items ?? []);
    setPolicyJson(JSON.stringify(policy, null, 2));
  }

  function assemblePolicy(): NegotiationPolicy {
    return {
      enabled: formEnabled,
      global: {
        minOfferDiscountPercent: formGlobalMin,
        maxDiscountPercent: formGlobalMax,
      },
      maxRounds: formMaxRounds,
      estimatedCostPerAiCallCents: formCostPerCall,
      ...(formMaxAiCost !== undefined ? { maxAiCostCents: formMaxAiCost } : {}),
      ...(formCategories.length > 0 ? { categories: formCategories } : {}),
      ...(formItems.length > 0 ? { items: formItems } : {}),
    };
  }

  async function loadPolicy() {
    setPolicyLoading(true);
    setPolicyMessage(null);
    try {
      const response = await api.getNegotiationPolicy();
      setHasCustomPolicy(response.has_custom_policy);
      populateForm(response.policy);
    } catch (e: any) {
      if (e?.status === 404 || (e instanceof DashboardHttpError && e.status === 404)) {
        setHasCustomPolicy(false);
      } else {
        const msg = e instanceof DashboardHttpError
          ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
          : e instanceof Error ? e.message : String(e);
        setPolicyMessage({ type: "error", text: msg });
      }
    } finally {
      setPolicyLoading(false);
    }
  }

  async function savePolicy() {
    setPolicyBusy(true);
    setPolicyMessage(null);
    setValidationErrors({});

    try {
      let payload: NegotiationPolicy;

      if (jsonMode) {
        try {
          payload = JSON.parse(policyJson) as NegotiationPolicy;
        } catch (e) {
          setPolicyMessage({ type: "error", text: `JSON inválido: ${(e as Error).message}` });
          setPolicyBusy(false);
          return;
        }
      } else {
        payload = assemblePolicy();
      }

      const errors = validatePolicy(payload);
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setPolicyMessage({ type: "error", text: "Corrija os erros de validação." });
        setPolicyBusy(false);
        return;
      }

      const response = await api.putNegotiationPolicy(payload);
      setHasCustomPolicy(response.has_custom_policy);
      populateForm(response.policy);
      setPolicyMessage({ type: "success", text: "Política salva com sucesso." });
    } catch (e) {
      const msg = e instanceof DashboardHttpError
        ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
        : e instanceof Error ? e.message : String(e);
      setPolicyMessage({ type: "error", text: msg });
    } finally {
      setPolicyBusy(false);
    }
  }

  function addCategory() {
    setFormCategories((prev) => [
      ...prev,
      { categoryId: "", minOfferDiscountPercent: 0, maxDiscountPercent: 10 },
    ]);
  }

  function removeCategory(index: number) {
    setFormCategories((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCategory(index: number, field: string, value: string | number) {
    setFormCategories((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  }

  function addItem() {
    setFormItems((prev) => [
      ...prev,
      { sku: "", minOfferDiscountPercent: 0, maxDiscountPercent: 10 },
    ]);
  }

  function removeItem(index: number) {
    setFormItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: string, value: string | number) {
    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  return (
    <div>
      {/* Status banner */}
      <div className="panel-info" style={{ marginBottom: "var(--space-4)" }}>
        {hasCustomPolicy
          ? "Política personalizada ativa."
          : "Usando política padrão do sistema."}
      </div>

      {policyMessage && (
        <p className={policyMessage.type === "success" ? "panel-info" : "panel-warn"}>
          {policyMessage.text}
        </p>
      )}

      {/* JSON mode toggle */}
      <div className="toggle-row">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Modo avançado (JSON)</span>
        <button
          type="button"
          className={`toggle-switch ${jsonMode ? "active" : ""}`}
          onClick={() => {
            if (!jsonMode) {
              setPolicyJson(JSON.stringify(assemblePolicy(), null, 2));
            }
            setJsonMode(!jsonMode);
          }}
          aria-pressed={jsonMode}
          aria-label="Alternar modo avançado"
        />
      </div>

      {jsonMode ? (
        <section className="panel stacked" style={{ marginTop: "var(--space-4)" }}>
          <div className="panel-title">
            <h2>Editor JSON</h2>
          </div>
          <textarea
            className="mono-textarea"
            value={policyJson}
            onChange={(e) => setPolicyJson(e.target.value)}
            rows={16}
            disabled={policyBusy || policyLoading}
            spellCheck={false}
            aria-label="JSON da política de negociação"
            style={{
              width: "100%",
              background: "#111827",
              color: "#E2E8F0",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              resize: "vertical",
              minHeight: 200,
            }}
          />
        </section>
      ) : (
        <section className="panel stacked" style={{ marginTop: "var(--space-4)" }}>
          <div className="panel-title">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Sliders size={16} style={{ color: "var(--color-brand)" }} />
              <h2>Política de negociação</h2>
            </div>
            {policyLoading && <span className="badge muted">carregando…</span>}
          </div>

          {/* Enable toggle */}
          <div className="toggle-row">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Negociação habilitada</span>
            <button
              type="button"
              className={`toggle-switch ${formEnabled ? "active" : ""}`}
              onClick={() => setFormEnabled(!formEnabled)}
              disabled={policyBusy || policyLoading}
              aria-pressed={formEnabled}
              aria-label="Negociação habilitada"
            />
          </div>

          {/* Global range */}
          <div className="policy-form-grid" style={{ marginTop: "var(--space-4)" }}>
            <div className="policy-form-field">
              <label htmlFor="neg-global-min">Desconto mínimo de oferta (%)</label>
              <input
                id="neg-global-min"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formGlobalMin}
                onChange={(e) => setFormGlobalMin(Number(e.target.value))}
                disabled={policyBusy || policyLoading}
              />
              {validationErrors["global.min"] && (
                <span className="field-error">{validationErrors["global.min"]}</span>
              )}
              {validationErrors["global.range"] && (
                <span className="field-error">{validationErrors["global.range"]}</span>
              )}
            </div>
            <div className="policy-form-field">
              <label htmlFor="neg-global-max">Desconto máximo (%)</label>
              <input
                id="neg-global-max"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formGlobalMax}
                onChange={(e) => setFormGlobalMax(Number(e.target.value))}
                disabled={policyBusy || policyLoading}
              />
              {validationErrors["global.max"] && (
                <span className="field-error">{validationErrors["global.max"]}</span>
              )}
            </div>
            <div className="policy-form-field">
              <label htmlFor="neg-max-rounds">Máximo de rodadas</label>
              <input
                id="neg-max-rounds"
                type="number"
                min={1}
                max={20}
                step={1}
                value={formMaxRounds}
                onChange={(e) => setFormMaxRounds(Number(e.target.value))}
                disabled={policyBusy || policyLoading}
              />
              {validationErrors["maxRounds"] && (
                <span className="field-error">{validationErrors["maxRounds"]}</span>
              )}
            </div>
            <div className="policy-form-field">
              <label htmlFor="neg-cost-per-call">Custo estimado por chamada IA (centavos)</label>
              <input
                id="neg-cost-per-call"
                type="number"
                min={0}
                step={1}
                value={formCostPerCall}
                onChange={(e) => setFormCostPerCall(Number(e.target.value))}
                disabled={policyBusy || policyLoading}
              />
              {validationErrors["costPerCall"] && (
                <span className="field-error">{validationErrors["costPerCall"]}</span>
              )}
            </div>
            <div className="policy-form-field">
              <label htmlFor="neg-max-ai-cost">Cap de custo IA (centavos)</label>
              <input
                id="neg-max-ai-cost"
                type="number"
                min={0}
                step={1}
                value={formMaxAiCost ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormMaxAiCost(v === "" ? undefined : Number(v));
                }}
                disabled={policyBusy || policyLoading}
                placeholder="Opcional"
              />
              {validationErrors["maxAiCost"] && (
                <span className="field-error">{validationErrors["maxAiCost"]}</span>
              )}
            </div>
          </div>

          {/* Category overrides */}
          <div style={{ marginTop: "var(--space-6)" }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: "var(--space-3)" }}>
              Categorias com política específica
            </h3>
            <div className="override-list">
              {formCategories.map((cat, i) => (
                <div key={i} className="override-row">
                  <input
                    type="text"
                    placeholder="ID da categoria"
                    value={cat.categoryId}
                    onChange={(e) => updateCategory(i, "categoryId", e.target.value)}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Categoria ${i + 1} ID`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={cat.minOfferDiscountPercent}
                    onChange={(e) => updateCategory(i, "minOfferDiscountPercent", Number(e.target.value))}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Categoria ${i + 1} mínimo`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={cat.maxDiscountPercent}
                    onChange={(e) => updateCategory(i, "maxDiscountPercent", Number(e.target.value))}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Categoria ${i + 1} máximo`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <button
                    type="button"
                    onClick={() => removeCategory(i)}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Remover categoria ${i + 1}`}
                    style={{ color: "var(--color-error)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCategory}
              disabled={policyBusy || policyLoading}
              style={{ marginTop: "var(--space-2)", fontSize: 12 }}
            >
              + Adicionar categoria
            </button>
          </div>

          {/* Item overrides */}
          <div style={{ marginTop: "var(--space-6)" }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: "var(--space-3)" }}>
              Itens com política específica
            </h3>
            <div className="override-list">
              {formItems.map((item, i) => (
                <div key={i} className="override-row">
                  <input
                    type="text"
                    placeholder="SKU"
                    value={item.sku}
                    onChange={(e) => updateItem(i, "sku", e.target.value)}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Item ${i + 1} SKU`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.minOfferDiscountPercent}
                    onChange={(e) => updateItem(i, "minOfferDiscountPercent", Number(e.target.value))}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Item ${i + 1} mínimo`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.maxDiscountPercent}
                    onChange={(e) => updateItem(i, "maxDiscountPercent", Number(e.target.value))}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Item ${i + 1} máximo`}
                    style={{ padding: "var(--space-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={policyBusy || policyLoading}
                    aria-label={`Remover item ${i + 1}`}
                    style={{ color: "var(--color-error)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItem}
              disabled={policyBusy || policyLoading}
              style={{ marginTop: "var(--space-2)", fontSize: 12 }}
            >
              + Adicionar item
            </button>
          </div>
        </section>
      )}

      {/* Action buttons */}
      <div className="button-row" style={{ marginTop: "var(--space-4)" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={policyBusy || policyLoading}
          onClick={() => void savePolicy()}
        >
          <Save size={14} />
          {policyBusy ? "Salvando…" : "Salvar política"}
        </button>
        <button
          type="button"
          disabled={policyBusy || policyLoading}
          onClick={() => void loadPolicy()}
        >
          <RefreshCw size={14} />
          Recarregar
        </button>
      </div>
    </div>
  );
}
