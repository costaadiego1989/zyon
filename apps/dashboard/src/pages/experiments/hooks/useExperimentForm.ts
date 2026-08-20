import { useMemo, useState } from "react";
import { showToast } from "../../../components/Toast.js";
import type { ExperimentForm, Variant } from "../types.js";

const DEFAULT_FORM: ExperimentForm = {
  name: "",
  description: "",
  variants: [
    { name: "Control", description: "" },
    { name: "Variant A", description: "" },
  ],
  sample_size: 100,
};

export function validateExperimentForm(form: ExperimentForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Nome é obrigatório";
  if (form.name.length > 255) errors.name = "Máximo 255 caracteres";
  if (form.variants.length < 2) errors.variants = "Mínimo 2 variantes";
  if (form.variants.length > 10) errors.variants = "Máximo 10 variantes";
  if (form.variants.some((v) => !v.name.trim())) errors.variants = "Todas as variantes precisam de um nome";
  if (form.sample_size < 10 || form.sample_size > 1000000) errors.sample_size = "Entre 10 e 1.000.000";
  return errors;
}

export function useExperimentForm() {
  const [form, setForm] = useState<ExperimentForm>(DEFAULT_FORM);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);

  const errors = useMemo(() => validateExperimentForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  function patch(p: Partial<ExperimentForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function addVariant() {
    setForm((prev) => ({
      ...prev,
      variants: [...prev.variants, { name: `Variant ${String.fromCharCode(65 + prev.variants.length)}` }],
    }));
  }

  function removeVariant(idx: number) {
    if (form.variants.length <= 2) {
      showToast("error", "Mínimo 2 variantes");
      return;
    }
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, i) => i !== idx),
    }));
  }

  function updateVariant(idx: number, updates: Partial<Variant>) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((v, i) => (i === idx ? { ...v, ...updates } : v)),
    }));
  }

  function openCreateForm() {
    setForm(DEFAULT_FORM);
    setFormMode("create");
  }

  function closeForm() {
    setFormMode(null);
  }

  function resetForm() {
    setForm(DEFAULT_FORM);
    setFormMode(null);
  }

  return {
    form,
    formMode,
    errors,
    hasErrors,
    patch,
    addVariant,
    removeVariant,
    updateVariant,
    openCreateForm,
    closeForm,
    resetForm,
  };
}
