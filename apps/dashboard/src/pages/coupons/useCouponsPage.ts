import { useCallback, useEffect, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";

export interface Coupon {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minCartValue?: number;
  maxUses?: number;
  usedCount: number;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateCouponForm {
  code: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  minCartValue: string;
  maxUses: string;
  expiresAt: string;
}

const DEFAULT_FORM: CreateCouponForm = {
  code: "",
  discountType: "percent",
  discountValue: "10",
  minCartValue: "",
  maxUses: "",
  expiresAt: "",
};

export function useCouponsPage() {
  const api = useApi();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateCouponForm>(DEFAULT_FORM);

  const loadCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listCoupons();
      setCoupons(data ?? []);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadCoupons(); }, [loadCoupons]);

  function patch(p: Partial<CreateCouponForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    patch({ code });
  }

  async function handleCreate() {
    if (!form.code.trim()) {
      showToast("error", "Código do cupom é obrigatório");
      return;
    }
    const discountValue = Number(form.discountValue);
    if (discountValue <= 0) {
      showToast("error", "Valor do desconto deve ser positivo");
      return;
    }

    setCreating(true);
    try {
      await api.createCoupon({
        code: form.code.toUpperCase().trim(),
        discount_type: form.discountType,
        discount_value: discountValue,
        min_cart_value: form.minCartValue ? Number(form.minCartValue) : undefined,
        max_uses: form.maxUses ? Number(form.maxUses) : undefined,
        expires_at: form.expiresAt || undefined,
      });
      showToast("success", `Cupom ${form.code.toUpperCase()} criado!`);
      setForm(DEFAULT_FORM);
      setShowForm(false);
      await loadCoupons();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao criar cupom");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Desativar este cupom?")) return;
    try {
      await api.deleteCoupon(id);
      showToast("success", "Cupom desativado");
      await loadCoupons();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao desativar");
    }
  }

  return {
    coupons,
    loading,
    creating,
    showForm,
    form,
    patch,
    generateCode,
    setShowForm,
    handleCreate,
    handleDelete,
  };
}
