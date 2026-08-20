import { useCallback, useEffect, useState } from "react";
import { readError } from "../utils/read-error.js";
import { useApi } from "../hooks/useApi.js";
import type { MerchantProfile } from "../api-client.js";

export interface AccountForm {
  name: string;
  email: string;
  phone: string;
}

export interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function useAccountSettingsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [form, setForm] = useState<AccountForm>({ name: "", email: "", phone: "" });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);

  // Load current user data
  useEffect(() => {
    if (!props.me) return;
    void loadProfile();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getMe();
      setForm({
        name: data.name || data.merchant_name || props.me?.name || "",
        email: data.email || "",
        phone: data.phone || "",
      });
    } catch { /* use props.me fallback */ }
    setLoading(false);
  }, [api, props.me]);

  const saveProfile = useCallback(async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.updateMe({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
      });
      setMessage({ text: "Dados atualizados com sucesso.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setSaving(false);
    }
  }, [api, form]);

  const changePassword = useCallback(async () => {
    if (!passwordForm.newPassword || !passwordForm.currentPassword) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ text: "Nova senha e confirmação não coincidem.", kind: "error" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setMessage({ text: "Nova senha deve ter no mínimo 6 caracteres.", kind: "error" });
      return;
    }
    setSavingPassword(true);
    setMessage(null);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setMessage({ text: "Senha alterada com sucesso.", kind: "ok" });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setSavingPassword(false);
    }
  }, [api, passwordForm]);

  return {
    form,
    setForm,
    passwordForm,
    setPasswordForm,
    saving,
    savingPassword,
    loading,
    message,
    saveProfile,
    changePassword,
  };
}
