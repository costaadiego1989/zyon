import React, { useEffect, useState } from "react";
import { Lock, UserRound } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button } from "../components/Button.js";
import { Modal } from "../components/Modal.js";
import { EmptyState } from "../components/EmptyState.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { FormField } from "../components/FormField.js";
import { useAccountSettingsPage } from "./useAccountSettingsPage.js";
import { maskPhone } from "../utils/masks.js";
import "./administration-pages.css";

export function AccountSettingsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useAccountSettingsPage({ me: props.me });
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const otpOpen = vm.otpStep === "confirm";
  useEffect(() => { setCode(""); setCooldown(otpOpen ? 60 : 0); }, [otpOpen]);
  useEffect(() => { if (cooldown > 0) { const timer = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(timer); } }, [cooldown]);
  if (!props.me) return <PageHeader title="Minha conta" description="Entre na sua conta para gerenciar seus dados." />;
  return <div className="administration-page">
    <PageHeader title="Minha conta" description="Atualize seus dados pessoais e gerencie o acesso à sua conta." />
    {vm.loading ? <section className="panel admin-skeleton" aria-label="Carregando dados pessoais" aria-busy="true">{[1, 2, 3].map(n => <div key={n} className="skeleton-cell" />)}</section> : vm.loadError ? <section className="panel"><EmptyState icon={UserRound} title="Dados pessoais indisponíveis" description="Não foi possível carregar sua conta. Tente novamente para editar os dados atuais." action={<Button variant="outline" onClick={() => void vm.loadProfile()}>Tentar novamente</Button>} /></section> : <>
      <form className="panel configuration-form admin-section" onSubmit={e => { e.preventDefault(); void vm.saveProfile(); }}>
        <SectionHeader title="Dados pessoais" variant="secondary" />
        <p className="admin-help">Ao mudar o e-mail, confirme o código enviado para o novo endereço. Nome e celular serão salvos após essa confirmação.</p>
        <fieldset disabled={vm.saving || otpOpen} className="admin-fields">
          <FormField label="Nome completo" value={vm.form.name} onChange={name => vm.setForm(f => ({ ...f, name }))} inputProps={{ required: true, autoComplete: "name" }} />
          <FormField label="E-mail" type="email" value={vm.form.email} onChange={email => vm.setForm(f => ({ ...f, email }))} inputProps={{ required: true, autoComplete: "email" }} />
          <FormField label="Celular / WhatsApp (opcional)" type="tel" placeholder="(11) 99999-9999" value={maskPhone(vm.form.phone)} onChange={phone => vm.setForm(f => ({ ...f, phone: maskPhone(phone) }))} maxLength={15} inputProps={{ autoComplete: "tel" }} />
        </fieldset>
        {vm.message && <p className={`admin-feedback admin-feedback--${vm.message.kind}`} role={vm.message.kind === "error" ? "alert" : "status"}>{vm.message.text}</p>}
        <div className="admin-actions"><Button type="submit" loading={vm.saving} disabled={otpOpen || !vm.form.name.trim() || !vm.form.email.trim()}>Salvar dados pessoais</Button></div>
      </form>
      <form className="panel configuration-form admin-section" onSubmit={e => { e.preventDefault(); void vm.changePassword(); }}>
        <SectionHeader title="Alterar senha" variant="secondary" />
        <p className="admin-help">Use pelo menos 8 caracteres e escolha uma senha exclusiva para sua conta.</p>
        <fieldset disabled={vm.savingPassword} className="admin-fields">
          <div className="admin-field-wide"><FormField label="Senha atual" type="password" value={vm.passwordForm.currentPassword} onChange={currentPassword => vm.setPasswordForm(f => ({ ...f, currentPassword }))} inputProps={{ required: true, autoComplete: "current-password" }} /></div>
          <FormField label="Nova senha" type="password" value={vm.passwordForm.newPassword} onChange={newPassword => vm.setPasswordForm(f => ({ ...f, newPassword }))} inputProps={{ required: true, minLength: 8, autoComplete: "new-password" }} />
          <FormField label="Confirmar nova senha" type="password" value={vm.passwordForm.confirmPassword} onChange={confirmPassword => vm.setPasswordForm(f => ({ ...f, confirmPassword }))} inputProps={{ required: true, autoComplete: "new-password" }} />
        </fieldset>
        {vm.passwordMessage && <p className={`admin-feedback admin-feedback--${vm.passwordMessage.kind}`} role={vm.passwordMessage.kind === "error" ? "alert" : "status"}>{vm.passwordMessage.text}</p>}
        <div className="admin-actions"><Button variant="outline" type="submit" loading={vm.savingPassword} disabled={!vm.passwordForm.currentPassword || !vm.passwordForm.newPassword || !vm.passwordForm.confirmPassword}><Lock size={16} /> Alterar senha</Button></div>
      </form>
    </>}
    <Modal isOpen={otpOpen} title="Confirme seu novo e-mail" subtitle={`Digite o código de 6 dígitos enviado para ${vm.maskedEmail}.`} presentation="center" size="md" onClose={vm.handleCancelOtp} footer={<><Button variant="ghost" disabled={vm.saving} onClick={vm.handleCancelOtp}>Cancelar</Button><Button type="submit" form="account-email-confirm" disabled={code.length !== 6} loading={vm.saving}>Confirmar e salvar</Button></>}>
      <form id="account-email-confirm" className="configuration-form administration-page" onSubmit={e => { e.preventDefault(); if (code.length === 6) void vm.handleConfirmOtp(code); }}>
        <FormField label="Código de confirmação" value={code} onChange={v => setCode(v.replace(/\D/g, "").slice(0, 6))} disabled={vm.saving} maxLength={6} inputProps={{ inputMode: "numeric", autoComplete: "one-time-code", pattern: "[0-9]{6}", required: true }} error={vm.otpError ?? undefined} />
        <p className="admin-help">Se não encontrar a mensagem, confira a pasta de spam. Os dados pessoais permanecem no formulário se você cancelar.</p>
        <Button variant="outline" disabled={vm.saving || cooldown > 0} onClick={() => { setCooldown(60); void vm.handleResendOtp(); }}>{cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}</Button>
      </form>
    </Modal>
  </div>;
}
