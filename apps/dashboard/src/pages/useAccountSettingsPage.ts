import { useCallback, useEffect, useState } from "react";
import { readError } from "../utils/read-error.js";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";
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

type OtpStep = "closed" | "request" | "confirm";

export function useAccountSettingsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [form, setForm] = useState<AccountForm>({ name: "", email: "", phone: "" });
  const [originalEmail, setOriginalEmail] = useState("");
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);

  // Email change OTP state
  const [otpStep, setOtpStep] = useState<OtpStep>("closed");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");

  // Load current user data
  useEffect(() => {
    if (!props.me) return;
    void loadProfile();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getMe();
      const email = data.email || "";
      setForm({
        name: data.name || data.merchant_name || props.me?.name || "",
        email,
        phone: data.phone || "",
      });
      setOriginalEmail(email);
    } catch { /* use props.me fallback */ }
    setLoading(false);
  }, [api, props.me]);

  const saveProfile = useCallback(async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const emailChanged = form.email.trim().toLowerCase() !== originalEmail.toLowerCase();
      if (emailChanged) {
        // Email change goes through OTP flow.
        setPendingEmail(form.email.trim());
        setOtpError(null);
        setMaskedEmail("");
        try {
          const res = await api.requestEmailChange(form.email.trim());
          setMaskedEmail(res.delivered_to);
          setOtpStep("confirm");
        } catch (e) {
          setMessage({ text: readError(e), kind: "error" });
        }
        return;
      }

      // No email change — save name/phone directly.
      await api.updateMe({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
      });
      setMessage({ text: "Dados atualizados com sucesso.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setSaving(false);
    }
  }, [api, form, originalEmail]);

  const handleConfirmOtp = useCallback(
    async (code: string) => {
      setOtpError(null);
      try {
        const res = await api.confirmEmailChange(pendingEmail, code);
        setOriginalEmail(res.email);
        setForm((f) => ({ ...f, email: res.email }));
        setOtpStep("closed");
        setMessage({ text: `Email alterado para ${res.email}.`, kind: "ok" });
        void loadProfile();
      } catch (e) {
        const err = readError(e);
        if (/otp_invalid|código/i.test(err)) {
          setOtpError("Código inválido. Verifique e tente novamente.");
        } else if (/otp_locked|bloqueado/i.test(err)) {
          setOtpError("Muitas tentativas. Solicite um novo código.");
        } else if (/otp_expired|expirado/i.test(err)) {
          setOtpError("Código expirado. Solicite um novo código.");
        } else if (/email_taken|em uso/i.test(err)) {
          setOtpError("Este email já está em uso por outra conta.");
        } else {
          setOtpError(err);
        }
        throw e;
      }
    },
    [api, pendingEmail, loadProfile],
  );

  const handleResendOtp = useCallback(async () => {
    setOtpError(null);
    try {
      const res = await api.requestEmailChange(pendingEmail);
      setMaskedEmail(res.delivered_to);
    } catch (e) {
      setOtpError(readError(e));
      throw e;
    }
  }, [api, pendingEmail]);

  const handleCancelOtp = useCallback(() => {
    setOtpStep("closed");
    setOtpError(null);
    setPendingEmail("");
  }, []);

  const changePassword = useCallback(async () => {
    if (!passwordForm.newPassword || !passwordForm.currentPassword) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast("error", "Nova senha e confirmação não coincidem.");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showToast("error", "Nova senha deve ter no mínimo 8 caracteres.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      showToast("success", "Senha alterada com sucesso");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) {
      showToast("error", readError(e));
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
    otpStep,
    otpError,
    pendingEmail,
    maskedEmail,
    handleConfirmOtp,
    handleResendOtp,
    handleCancelOtp,
  };
}
