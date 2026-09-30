import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import { validIncentivePolicy, type IncentivePolicy, type IncentivePolicyCommand } from "../../api/endpoints/incentive-policy.js";
import "./incentive-policy.css";

type Draft = { enabled: boolean; total: string; discount: string; uses: string };
const money = (n: number) => (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const draftOf = (p: IncentivePolicy): Draft => ({ enabled: p.enabled,
  total: p.limitCents ? (p.limitCents / 100).toFixed(2).replace(".", ",") : "",
  discount: p.maxDiscountCents ? (p.maxDiscountCents / 100).toFixed(2).replace(".", ",") : "",
  uses: p.maxRedemptions ? String(p.maxRedemptions) : "" });
// No rounding, exponent notation or ambiguous thousands separators for money.
const cents = (value: string) => {
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : NaN;
};
const summary = (p: IncentivePolicy) => p.enabled
  ? `${money(p.limitCents)} por teste · até ${money(p.maxDiscountCents)} por pedido · ${p.maxRedemptions.toLocaleString("pt-BR")} usos`
  : "Novos descontos desativados";

/** Parent keys this component by authenticated merchant, dropping stale drafts and replies on store switches. */
export function IncentivePolicySettings({ merchantId }: { merchantId: string }) {
  const api = useApi();
  const helpId = useId();
  const [policy, setPolicy] = useState<IncentivePolicy | null>(null);
  const [draft, setDraft] = useState<Draft>({ enabled: false, total: "", discount: "", uses: "" });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<IncentivePolicyCommand | null>(null);
  const alive = useRef(false), locked = useRef(false), sequence = useRef(0);
  const pendingRef = useRef<IncentivePolicyCommand | null>(null);
  const accept = useCallback((value: unknown) => {
    if (!validIncentivePolicy(value, merchantId)) throw new Error("Invalid financial settings response");
    return value;
  }, [merchantId]);

  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const seq = ++sequence.current;
    try {
      const current = accept(await api.getIncentivePolicy());
      if (alive.current && seq === sequence.current) { setPolicy(current); setDraft(draftOf(current)); }
    } catch {
      if (alive.current && seq === sequence.current) setError("Não foi possível carregar os limites. Tente novamente.");
    } finally {
      if (alive.current && seq === sequence.current) { locked.current = false; setBusy(false); }
    }
  }, [api, accept]);

  useEffect(() => {
    alive.current = true; locked.current = false; void load();
    return () => { alive.current = false; ++sequence.current; };
  }, [load]);

  const save = async () => {
    if (locked.current || !policy || conflict) return;
    const empty = !draft.enabled && !draft.total.trim() && !draft.discount.trim() && !draft.uses.trim();
    const command = pendingRef.current ?? { enabled: draft.enabled,
      limitCents: empty ? 0 : cents(draft.total), maxDiscountCents: empty ? 0 : cents(draft.discount),
      maxRedemptions: empty ? 0 : /^\d+$/.test(draft.uses) ? Number(draft.uses) : NaN,
      expectedVersion: policy.version, requestKey: createIdempotencyKey() };
    if (!validIncentivePolicy({ ...command, merchantId, version: policy.version + 1, policyHash: policy.policyHash }, merchantId)) {
      setError("Preencha valores positivos, com até duas casas decimais. O desconto por pedido não pode ultrapassar o total por teste. Informe no máximo 1.000.000 de usos."); return;
    }
    locked.current = true; setBusy(true); setError(""); setNotice("");
    pendingRef.current = command; setPending(command);
    const seq = ++sequence.current;
    const active = () => alive.current && seq === sequence.current;
    try {
      const receipt = accept(await api.saveIncentivePolicy(command));
      if (receipt.version !== command.expectedVersion + 1 || receipt.enabled !== command.enabled || receipt.limitCents !== command.limitCents
        || receipt.maxDiscountCents !== command.maxDiscountCents || receipt.maxRedemptions !== command.maxRedemptions) throw new Error("Invalid receipt");
      // A retry may return an older receipt. Always fetch the current policy.
      const current = accept(await api.getIncentivePolicy());
      if (current.version < receipt.version) throw new Error("Stale settings response");
      if (!active()) return;
      setPolicy(current); setDraft(draftOf(current)); pendingRef.current = null; setPending(null);
      setNotice(current.version === receipt.version ? "Limites salvos. Nenhum teste foi iniciado."
        : "Sua alteração foi salva. Os limites abaixo já incluem uma alteração posterior.");
    } catch (cause) {
      if (!active()) return;
      if (cause instanceof DashboardHttpError && cause.status === 409) {
        // Preserve the draft, but require an explicit choice after refreshing.
        try {
          const current = accept(await api.getIncentivePolicy());
          if (!active()) return;
          setPolicy(current); setConflict(true); pendingRef.current = null; setPending(null);
          setError("Os limites mudaram em outra sessão. Confira os valores atuais antes de salvar sua proposta.");
        } catch { if (active()) setError("Não foi possível conferir os limites atuais. Tente confirmar novamente."); }
      } else if (cause instanceof DashboardHttpError && [400, 401, 403, 404].includes(cause.status)) {
        pendingRef.current = null; setPending(null);
        setError(cause.status === 400 ? "Os limites não foram aceitos. Confira os valores informados."
          : "Não foi possível salvar. Confira sua sessão e a permissão para configurar esta loja.");
      } else setError("Ainda não foi possível confirmar o salvamento. Tente confirmar novamente para evitar uma alteração duplicada.");
    } finally { if (active()) { locked.current = false; setBusy(false); } }
  };
  const edit = (patch: Partial<Draft>) => { setDraft(d => ({ ...d, ...patch })); setError(""); setNotice(""); };
  const unchanged = policy && draft.enabled === policy.enabled
    && (draft.total.trim() ? cents(draft.total) : 0) === policy.limitCents
    && (draft.discount.trim() ? cents(draft.discount) : 0) === policy.maxDiscountCents
    && (draft.uses.trim() ? /^\d+$/.test(draft.uses) ? Number(draft.uses) : NaN : 0) === policy.maxRedemptions;

  return <details className="incentive-policy">
    <summary><span><strong>Limites de desconto</strong><span className="incentive-policy-subtitle">
      {policy ? summary(policy) : busy ? "Carregando limites…" : "Limites indisponíveis"}
    </span></span><span className="incentive-policy-open"><span className="incentive-policy-expand">Configurar</span><span className="incentive-policy-collapse">Fechar</span></span></summary>
    <div className="incentive-policy-content">
      <p>Defina quanto sua loja pode conceder em descontos nos testes sugeridos pela IA.
        A IA recomenda a estratégia e você aprova antes de ela começar. Cada desconto também precisa respeitar as margens e regras comerciais da loja.</p>
      <p className="incentive-policy-help">Este orçamento representa descontos nas vendas. Não é uma cobrança da Zyon nem o custo de uso da IA.</p>
      {error && <p role="alert" className="incentive-policy-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!policy ? <button type="button" className="zyn-btn zyn-btn--secondary" disabled={busy} onClick={() => void load()}>
        {busy ? "Carregando…" : "Tentar novamente"}</button> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy || Boolean(pending)}>
          <label className="incentive-policy-enable"><input type="checkbox" checked={draft.enabled} onChange={e => edit({ enabled: e.target.checked })} />
            Permitir descontos nos testes que eu aprovar</label>
          <div className="incentive-policy-fields">
            <div><label>Total de descontos por teste (R$)<input type="text" inputMode="decimal" value={draft.total} onChange={e => edit({ total: e.target.value })} placeholder="Ex.: 300,00" maxLength={15} aria-describedby={`${helpId}-total`} /></label>
              <p id={`${helpId}-total`} className="incentive-policy-field-help">Soma máxima dos descontos de um único teste aprovado.</p></div>
            <div><label>Desconto máximo por pedido (R$)<input type="text" inputMode="decimal" value={draft.discount} onChange={e => edit({ discount: e.target.value })} placeholder="Ex.: 10,00" maxLength={15} aria-describedby={`${helpId}-discount`} /></label>
              <p id={`${helpId}-discount`} className="incentive-policy-field-help">Maior desconto que o teste pode oferecer em uma compra.</p></div>
            <div><label>Máximo de usos por teste<input type="text" inputMode="numeric" value={draft.uses} onChange={e => edit({ uses: e.target.value })} placeholder="Ex.: 30" maxLength={7} aria-describedby={`${helpId}-uses`} /></label>
              <p id={`${helpId}-uses`} className="incentive-policy-field-help">Quantas vezes o desconto pode ser utilizado no teste.</p></div>
          </div>
        </fieldset>
        <p className="incentive-policy-example"><strong>Exemplo:</strong> R$ 300 por teste, com até R$ 10 por pedido e 30 usos,
          permite até 30 descontos de R$ 10. Novos descontos são bloqueados quando o valor disponível ou a quantidade de usos se esgota.</p>
        <p className="incentive-policy-help">Salvar estes limites não inicia um teste. Ao alterar ou desativar, os testes com os limites anteriores deixam de oferecer novos descontos.
          Valores separados para compras em andamento continuam no controle do orçamento até serem confirmados ou liberados.</p>
        {conflict ? <div className="incentive-policy-conflict"><p><strong>Limites atuais:</strong> {summary(policy)}</p>
          <div className="incentive-policy-actions">
            <button type="button" className="zyn-btn zyn-btn--secondary" onClick={() => { setDraft(draftOf(policy)); setConflict(false); setError(""); }}>Usar limites atuais</button>
            <button type="button" className="zyn-btn zyn-btn--secondary" onClick={() => { setConflict(false); setError(""); }}>Manter meus valores</button>
          </div></div> : <button type="submit" className="zyn-btn zyn-btn--primary" disabled={busy || (!pending && Boolean(unchanged))}>
            {busy ? "Salvando…" : pending ? "Confirmar salvamento" : "Salvar limites"}</button>}
      </form>}
    </div>
  </details>;
}
