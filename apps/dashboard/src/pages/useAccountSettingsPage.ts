import { useCallback, useEffect, useState } from "react";
import { readError } from "../utils/read-error.js";
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

export function useAccountSettingsPage(props: { me: MerchantProfile | null; apiBaseUrl: string }) {
  const baseUrl = props.apiBaseUrl.replace(/\/+$/, "");
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
      const res = await fetch(`${baseUrl}/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setForm({
          name: data.name || data.merchant_name || props.me?.name || "",
          email: data.email || "",
          phone: data.phone || "",
        });
      }
    } catch { /* use props.me fallback */ }
    setLoading(false);
  }, [baseUrl, props.me]);

  const saveProfile = useCallback(async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${baseUrl}/auth/me`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage({ text: "Dados atualizados com sucesso.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setSaving(false);
    }
  }, [baseUrl, form]);

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
      const res = await fetch(`${baseUrl}/auth/me/password`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body.includes("invalid") ? "Senha atual incorreta." : body.slice(0, 100));
      }
      setMessage({ text: "Senha alterada com sucesso.", kind: "ok" });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setSavingPassword(false);
    }
  }, [baseUrl, passwordForm]);

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
