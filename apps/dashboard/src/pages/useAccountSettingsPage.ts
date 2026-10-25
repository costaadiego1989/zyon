import { useCallback, useEffect, useRef, useState } from "react";
import { reportError } from "../hooks/useErrorReporter.js";
import { readError } from "../utils/read-error.js";
import { useApi } from "../hooks/useApi.js";
import type { MerchantProfile } from "../api-client.js";

export interface AccountForm { name: string; email: string; phone: string }
export interface PasswordForm { currentPassword: string; newPassword: string; confirmPassword: string }
type Feedback = { text: string; kind: "ok" | "error" } | null;

export function useAccountSettingsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [form, setForm] = useState<AccountForm>({ name: "", email: "", phone: "" });
  const [originalEmail, setOriginalEmail] = useState("");
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const working = useRef(false);
  const passwordWorking = useRef(false);
  const [message, setMessage] = useState<Feedback>(null);
  const [passwordMessage, setPasswordMessage] = useState<Feedback>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState<"closed" | "confirm">("closed");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await api.getMe();
      const email = data.email || "";
      setForm({ name: data.name || data.merchant_name || props.me?.name || "", email, phone: data.phone || "" });
      setOriginalEmail(email);
    } catch (e) { setLoadError(readError(e)); }
    finally { setLoading(false); }
  }, [api, props.me?.name]);
  useEffect(() => { if (props.me) void loadProfile(); }, [props.me?.id, loadProfile]);

  const saveProfile = useCallback(async () => {
    if (working.current || loading || loadError || !form.name.trim() || !form.email.trim()) return;
    working.current = true; setSaving(true); setMessage(null);
    try {
      if (form.email.trim().toLowerCase() !== originalEmail.toLowerCase()) {
        const res = await api.requestEmailChange(form.email.trim());
        setPendingEmail(form.email.trim()); setMaskedEmail(res.delivered_to); setOtpError(null); setOtpStep("confirm");
      } else {
        await api.updateMe({ name: form.name.trim(), phone: form.phone.trim() || undefined });
        setMessage({ text: "Dados pessoais salvos.", kind: "ok" });
      }
    } catch (e) { reportError({ source: "dashboard.account.save", error: e }); setMessage({ text: "Não foi possível salvar. Seus dados foram mantidos; tente novamente.", kind: "error" }); }
    finally { working.current = false; setSaving(false); }
  }, [api, form, originalEmail, loading, loadError]);

  const handleConfirmOtp = useCallback(async (code: string) => {
    if (working.current) return;
    working.current = true; setSaving(true); setOtpError(null);
    let emailConfirmed = false;
    try {
      const res = await api.confirmEmailChange(pendingEmail, code);
      emailConfirmed = true; setOriginalEmail(res.email); setForm((f) => ({ ...f, email: res.email })); setOtpStep("closed");
      await api.updateMe({ name: form.name.trim(), phone: form.phone.trim() || undefined });
      setMessage({ text: "E-mail confirmado e dados pessoais salvos.", kind: "ok" });
    } catch (e) {
      reportError({ source: "dashboard.account.confirm-email", error: e });
      if (emailConfirmed) setMessage({ text: "Seu e-mail foi alterado, mas não foi possível salvar nome e celular. Os dados foram mantidos; clique em Salvar dados pessoais para tentar novamente.", kind: "error" });
      else {
        const error = readError(e);
        setOtpError(/otp_locked|bloqueado/i.test(error) ? "Muitas tentativas. Solicite um novo código." : /otp_expired|expirado/i.test(error) ? "Código expirado. Solicite um novo código." : /otp_invalid|código/i.test(error) ? "Código inválido. Confira os seis dígitos e tente novamente." : /email_taken|em uso/i.test(error) ? "Este e-mail já está em uso por outra conta." : "Não foi possível confirmar o código. Tente novamente.");
      }
    } finally { working.current = false; setSaving(false); }
  }, [api, pendingEmail, form.name, form.phone]);

  const handleResendOtp = useCallback(async () => {
    if (working.current) return;
    working.current = true; setSaving(true); setOtpError(null);
    try { const res = await api.requestEmailChange(pendingEmail); setMaskedEmail(res.delivered_to); }
    catch (e) { reportError({ source: "dashboard.account.resend-email", error: e }); setOtpError("Não foi possível reenviar o código. Tente novamente após o intervalo."); }
    finally { working.current = false; setSaving(false); }
  }, [api, pendingEmail]);
  const handleCancelOtp = useCallback(() => { if (!working.current) { setOtpStep("closed"); setOtpError(null); } }, []);

  const changePassword = useCallback(async () => {
    if (passwordWorking.current || !passwordForm.currentPassword || !passwordForm.newPassword) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setPasswordMessage({ text: "A confirmação precisa ser igual à nova senha.", kind: "error" }); return; }
    if (passwordForm.newPassword.length < 8) { setPasswordMessage({ text: "Use pelo menos 8 caracteres na nova senha.", kind: "error" }); return; }
    passwordWorking.current = true; setSavingPassword(true); setPasswordMessage(null);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordMessage({ text: "Senha alterada. Use a nova senha no próximo acesso.", kind: "ok" });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) { reportError({ source: "dashboard.account.password", error: e }); setPasswordMessage({ text: "Não foi possível alterar a senha. Confira a senha atual e tente novamente.", kind: "error" }); }
    finally { passwordWorking.current = false; setSavingPassword(false); }
  }, [api, passwordForm]);

  return { form, setForm, passwordForm, setPasswordForm, saving, savingPassword, loading, loadError, loadProfile, message, passwordMessage, saveProfile, changePassword, otpStep, otpError, pendingEmail, maskedEmail, handleConfirmOtp, handleResendOtp, handleCancelOtp };
}
