import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile } from "../../../api-client.js";
import type { ServiceProfessionalDTO as ServiceProfessional } from "../../../api/endpoints/service-attendance.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import { useApi } from "../../../hooks/useApi.js";

type LinkRow = { professional: ServiceProfessional; selected: boolean; status: "saved" | "pending" | "saving" | "failed"; message?: string };
type LinkState = { context: object; rows: LinkRow[]; loading: boolean; saving: boolean; error: string | null; needsReload: boolean };
export interface ServiceProfessionalLinksOptions {
  me: MerchantProfile | null;
  productId: string | null;
  businessMode: "products" | "services" | null;
  productType: string;
  blocked: boolean;
}

function validateProfessional(raw: ServiceProfessional, merchantId: string): ServiceProfessional {
  if (!raw || typeof raw.id !== "string" || !raw.id || raw.merchantId !== merchantId || typeof raw.publicName !== "string"
    || typeof raw.isActive !== "boolean" || typeof raw.isPublished !== "boolean" || !Number.isSafeInteger(raw.version) || raw.version < 1
    || !Array.isArray(raw.services) || raw.services.length > 100 || raw.services.some(link => !link || typeof link.productId !== "string" || !link.productId)
    || new Set(raw.services.map(link => link.productId)).size !== raw.services.length) throw new Error("invalid_professional_response");
  return raw;
}
const linked = (professional: ServiceProfessional, productId: string) => professional.services.some(link => link.productId === productId);

export function useServiceProfessionalLinks(options: ServiceProfessionalLinksOptions) {
  const api = useApi();
  const { me, productId, businessMode, productType, blocked } = options;
  const merchantId = me?.id;
  const allowed = Boolean(canManageServiceAttendance(me) && productId?.trim() && businessMode === "services" && productType === "service" && !blocked);
  const context = useMemo(() => ({ client: allowed && me ? api.serviceAttendance(me) : null }),
    [api, allowed, me?.id, me?.user_id, me?.role, me?.businessMode, me?.businessModeSelectionState, productId, businessMode, productType, blocked]);
  const current = useRef<object | null>(context); current.current = context;
  const submitting = useRef<object | null>(null);
  const [state, setState] = useState<LinkState>({ context, rows: [], loading: allowed, saving: false, error: null, needsReload: false });
  const stateRef = useRef(state); stateRef.current = state;
  const empty: LinkState = { context, rows: [], loading: allowed, saving: false, error: null, needsReload: false };
  const visible = state.context === context ? state : empty;

  async function readAll(): Promise<ServiceProfessional[] | null> {
    if (!merchantId || !allowed || !context.client || current.current !== context) return null;
    const professionals = new Map<string, ServiceProfessional>(), cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      if (current.current !== context) return null;
      const page = await context.client.listProfessionals({ limit: 25, ...(cursor === undefined ? {} : { cursor }) });
      if (current.current !== context) return null;
      if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 191))) throw new Error("invalid_professional_page");
      for (const raw of page.items) {
        const professional = validateProfessional(raw, merchantId), previous = professionals.get(professional.id);
        if (!previous || professional.version > previous.version) professionals.set(professional.id, professional);
        else if (professional.version === previous.version && JSON.stringify(professional.services) !== JSON.stringify(previous.services)) throw new Error("inconsistent_professional_page");
      }
      if (page.nextCursor === null) break;
      if (cursors.has(page.nextCursor)) throw new Error("repeated_professional_cursor");
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    } while (cursor !== undefined);
    return [...professionals.values()];
  }

  async function load(preserveIntent: boolean) {
    if (!allowed || current.current !== context || !productId || submitting.current === context) return;
    const prior = stateRef.current.context === context ? stateRef.current.rows : [];
    const intent = new Map(preserveIntent ? prior.filter(row => row.selected !== linked(row.professional, productId)).map(row => [row.professional.id, row.selected]) : []);
    setState(previous => ({ ...(previous.context === context ? previous : empty), loading: true, error: null }));
    try {
      const professionals = await readAll(); if (!professionals || current.current !== context) return;
      const rows: LinkRow[] = professionals.map(professional => {
        const saved = linked(professional, productId), selected = intent.get(professional.id) ?? saved;
        return { professional, selected, status: selected === saved ? "saved" : "pending",
          ...(!professional.isActive && selected !== saved ? { message: "Este profissional foi desativado. A alteração selecionada ainda não foi salva." } : {}) };
      });
      setState({ context, rows, loading: false, saving: false, error: null, needsReload: false });
    } catch {
      if (current.current === context) setState(previous => ({ ...previous, context, loading: false, saving: false, error: "Não foi possível carregar os profissionais. Recarregue para continuar.", needsReload: true }));
    }
  }

  useEffect(() => {
    current.current = context;
    setState({ context, rows: [], loading: allowed, saving: false, error: null, needsReload: false });
    if (allowed) void load(false);
    return () => { if (current.current === context) current.current = null; };
    // The context includes every permission/tenant/item input; api identity is
    // independently included so a client replacement cancels the prior load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, api]);

  function select(id: string, selected: boolean) {
    if (!allowed || current.current !== context || submitting.current === context || visible.saving || visible.loading) return;
    setState(previous => previous.context !== context ? previous : { ...previous, rows: previous.rows.map(row => row.professional.id === id && row.professional.isActive ? { ...row, selected, status: "pending", message: undefined } : row) });
  }
  function updateRow(id: string, change: Partial<LinkRow>) {
    if (current.current !== context) return;
    setState(previous => previous.context !== context ? previous : { ...previous, rows: previous.rows.map(row => row.professional.id === id ? { ...row, ...change } : row) });
  }
  async function save() {
    if (!allowed || !merchantId || !productId || !context.client || current.current !== context || submitting.current === context || visible.loading || visible.saving || visible.needsReload) return;
    const pending = visible.rows.filter(row => row.professional.isActive && row.selected !== linked(row.professional, productId));
    if (!pending.length) return;
    submitting.current = context;
    setState(previous => ({ ...previous, saving: true, error: null }));
    try {
      for (const row of pending) {
        if (current.current !== context) return;
        const existing = row.professional.services.map(link => link.productId);
        const productIds = row.selected ? [...new Set([...existing, productId])] : existing.filter(id => id !== productId);
        if (productIds.length > 100) { updateRow(row.professional.id, { status: "failed", message: "Este profissional já atingiu o limite de 100 serviços. Revise seus outros vínculos antes de adicionar este." }); break; }
        updateRow(row.professional.id, { status: "saving", message: undefined });
        try {
          const result = validateProfessional(await context.client.updateProfessional(row.professional.id, { expectedVersion: row.professional.version, productIds }), merchantId);
          if (current.current !== context) return;
          if (result.id !== row.professional.id || result.version !== row.professional.version + 1 || JSON.stringify(result.services.map(link => link.productId).sort()) !== JSON.stringify([...productIds].sort())) throw new Error("unconfirmed_professional_update");
          updateRow(result.id, { professional: result, status: "saved", message: "Vínculo salvo." });
        } catch (error) {
          if (current.current !== context) return;
          const status = error instanceof DashboardHttpError ? error.status : 0;
          if (status === 0 || status >= 500) {
            try {
              const authoritative = (await readAll())?.find(item => item.id === row.professional.id);
              if (current.current !== context) return;
              if (authoritative && linked(authoritative, productId) === row.selected) {
                updateRow(authoritative.id, { professional: authoritative, status: "saved", message: "Vínculo confirmado após verificar o servidor." });
                continue;
              }
            } catch { /* Unknown persistence remains blocked until an explicit reload. */ }
          }
          if (current.current !== context) return;
          updateRow(row.professional.id, { status: "failed", message: status === 409 ? "Este profissional mudou. Recarregue e revise os vínculos antes de confirmar." : "Não foi possível confirmar este vínculo. Recarregue para verificar o estado salvo." });
          setState(previous => ({ ...previous, needsReload: true }));
          break;
        }
      }
    } finally {
      if (submitting.current === context) submitting.current = null;
      if (current.current === context) setState(previous => ({ ...previous, saving: false }));
    }
  }
  const dirty = visible.rows.some(row => productId && row.selected !== linked(row.professional, productId));
  const canSave = allowed && !visible.loading && !visible.saving && !visible.needsReload && visible.rows.some(row => row.professional.isActive && productId && row.selected !== linked(row.professional, productId));
  return { ...visible, allowed, select, save, reload: () => { if (submitting.current !== context && !visible.saving) void load(true); }, dirty, canSave };
}
