import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { DashboardHttpError } from "../../api/http/error.js";
export interface Coupon {
  id: string; code: string; discountType: "percent" | "fixed" | "free_shipping"; discountValue: number;
  minCartValue?: number; maxUses?: number; usedCount: number; startsAt?: string; expiresAt?: string;
  productId?: string; categoryId?: string; isActive: boolean; createdAt: string;
  strategyIncentiveExecutionId?: string | null;
  status?: string;
  strategyIncentiveState?: "active" | "scheduled" | "capacity_reached" | "ended" | "closed" | "paused" | "unavailable" | null;
}
export interface CreateCouponForm {
  code: string; discountType: Coupon["discountType"]; discountValue: string;
  minCartValue: string; maxUses: string; startsAt: string; expiresAt: string;
}
function todayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
const defaultForm = (): CreateCouponForm => ({ code: "", discountType: "percent", discountValue: "10", minCartValue: "", maxUses: "", startsAt: todayDate(), expiresAt: "" });
const managedMessage = "Este cupom é gerenciado pela estratégia de IA. Consulte ou interrompa o teste em Otimização com IA.";
function isManagedCouponError(error: unknown) {
  if (!(error instanceof DashboardHttpError)) return false;
  try {
    const body = JSON.parse(error.responseBody);
    return body.code === "COUPON_MANAGED_BY_STRATEGY" || body.message === "COUPON_MANAGED_BY_STRATEGY";
  } catch { return false; }
}
export function useCouponsPage() {
  const api = useApi();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateCouponForm>(defaultForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CreateCouponForm, string>>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const loadCoupons = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try { const data = await api.listCoupons(); setCoupons((data ?? []) as unknown as Coupon[]); }
    catch { setLoadError("Não foi possível carregar os cupons. Tente novamente."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void loadCoupons(); }, [loadCoupons]);
  function patch(p: Partial<CreateCouponForm>) {
    setForm(previous => ({ ...previous, ...p })); setFormError(null);
    setFieldErrors(previous => {
      const next = { ...previous };
      for (const key of Object.keys(p) as Array<keyof CreateCouponForm>) delete next[key];
      if (p.discountType) delete next.discountValue;
      if (p.startsAt !== undefined) delete next.expiresAt;
      return next;
    });
  }
  function generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    patch({ code });
  }
  async function handleCreate() {
    if (creating) return;
    const errors: Partial<Record<keyof CreateCouponForm, string>> = {};
    if (!form.code.trim()) errors.code = "Informe um código para o cupom.";
    const discount = Number(form.discountValue);
    if (form.discountType !== "free_shipping") {
      if (!Number.isFinite(discount) || discount <= 0) errors.discountValue = "Informe um desconto maior que zero.";
      else if (form.discountType === "percent" && discount > 100) errors.discountValue = "O percentual deve ser de até 100%.";
    }
    if (form.minCartValue && (!Number.isFinite(Number(form.minCartValue)) || Number(form.minCartValue) < 0)) errors.minCartValue = "Informe um valor maior ou igual a zero.";
    if (form.maxUses && (!Number.isInteger(Number(form.maxUses)) || Number(form.maxUses) < 1)) errors.maxUses = "Informe um número inteiro maior que zero.";
    if (form.expiresAt && form.expiresAt < (form.startsAt || todayDate())) errors.expiresAt = "A data final não pode ser anterior ao início.";
    setFieldErrors(errors); setFormError(null);
    setValidationAttempt(attempt => attempt + 1);
    if (Object.keys(errors).length) return;
    setCreating(true);
    try {
      await api.createCoupon({ code: form.code.toUpperCase().trim(), discount_type: form.discountType,
        discount_value: form.discountType === "free_shipping" ? 0 : discount,
        min_cart_value: form.minCartValue ? Number(form.minCartValue) : undefined,
        max_uses: form.maxUses ? Number(form.maxUses) : undefined,
        starts_at: form.startsAt || todayDate(), expires_at: form.expiresAt || undefined, is_active: true });
      showToast("success", `Cupom ${form.code.toUpperCase().trim()} criado`);
      setForm(defaultForm()); setShowForm(false); await loadCoupons();
    } catch { setFormError("Não foi possível criar o cupom. Seus dados foram mantidos. Revise o código e tente novamente."); }
    finally { setCreating(false); }
  }
  async function handleDelete(id: string): Promise<boolean> {
    if (mutatingId) return false;
    if (coupons.some(coupon => coupon.id === id && coupon.strategyIncentiveExecutionId)) { setDeleteError(managedMessage); return false; }
    setMutatingId(id); setDeleteError(null);
    try {
      await api.deleteCoupon(id);
      setCoupons(previous => previous.filter(coupon => coupon.id !== id));
      showToast("success", "Cupom arquivado"); return true;
    } catch (error) { setDeleteError(isManagedCouponError(error) ? managedMessage : "Não foi possível arquivar o cupom. Tente novamente."); return false; }
    finally { setMutatingId(null); }
  }
  async function handleToggleActive(id: string, currentlyActive: boolean) {
    if (mutatingId) return;
    if (coupons.some(coupon => coupon.id === id && coupon.strategyIncentiveExecutionId)) { showToast("error", managedMessage); return; }
    setMutatingId(id);
    try {
      await api.toggleCoupon(id, !currentlyActive);
      setCoupons(previous => previous.map(coupon => coupon.id === id ? { ...coupon, isActive: !currentlyActive } : coupon));
      showToast("success", currentlyActive ? "Cupom pausado" : "Cupom ativado");
    } catch (error) { showToast("error", isManagedCouponError(error) ? managedMessage : "Não foi possível alterar o status do cupom. Tente novamente."); }
    finally { setMutatingId(null); }
  }
  return { coupons, loading, loadError, reload: loadCoupons, creating, showForm, form, fieldErrors, validationAttempt, formError, patch, generateCode,
    openForm: () => { setFormError(null); setFieldErrors({}); setShowForm(true); }, closeForm: () => { if (!creating) setShowForm(false); },
    mutatingId, deleteError, clearDeleteError: () => setDeleteError(null), handleCreate, handleDelete, handleToggleActive };
}
