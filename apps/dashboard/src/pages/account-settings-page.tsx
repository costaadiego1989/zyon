import React from "react";
import { Settings, Lock } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { FormField } from "../components/FormField.js";
import { useAccountSettingsPage } from "./useAccountSettingsPage.js";

export function AccountSettingsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useAccountSettingsPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="page-lead">Login necessário para acessar configurações da conta</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Conta</span>
          <h1>Configurações</h1>
          <p className="page-lead">Gerencie seus dados pessoais e credenciais de acesso</p>
        </div>
      </header>

      {vm.message ? (
        <p className={`panel ${vm.message.kind === "ok" ? "panel-ok" : "panel-warn"}`}>{vm.message.text}</p>
      ) : null}

      {/* Profile section */}
      <section className="panel stacked">
        <SectionHeader title="Dados pessoais" variant="secondary" />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FormField label="Nome completo" placeholder="Seu nome" value={vm.form.name} onChange={(v) => vm.setForm((f) => ({ ...f, name: v }))} />
          <FormField label="Email" type="email" placeholder="seu@email.com" value={vm.form.email} onChange={(v) => vm.setForm((f) => ({ ...f, email: v }))} />
          <FormField label="Celular / WhatsApp" type="tel" placeholder="(11) 99999-9999" value={vm.form.phone} onChange={(v) => vm.setForm((f) => ({ ...f, phone: v }))} />
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" arrow disabled={vm.saving || !vm.form.name.trim() || !vm.form.email.trim()} onClick={() => void vm.saveProfile()}>
            {vm.saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </section>

      {/* Password section */}
      <section className="panel stacked" style={{ marginTop: 16 }}>
        <SectionHeader title="Alterar senha" variant="secondary" />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FormField label="Senha atual" type="password" placeholder="••••••••" value={vm.passwordForm.currentPassword} onChange={(v) => vm.setPasswordForm((f) => ({ ...f, currentPassword: v }))} />
          <FormField label="Nova senha" type="password" placeholder="Mínimo 6 caracteres" value={vm.passwordForm.newPassword} onChange={(v) => vm.setPasswordForm((f) => ({ ...f, newPassword: v }))} />
          <FormField label="Confirmar nova senha" type="password" placeholder="Repita a nova senha" value={vm.passwordForm.confirmPassword} onChange={(v) => vm.setPasswordForm((f) => ({ ...f, confirmPassword: v }))} />
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="outline"
            size="sm"
            disabled={vm.savingPassword || !vm.passwordForm.currentPassword || !vm.passwordForm.newPassword || !vm.passwordForm.confirmPassword}
            onClick={() => void vm.changePassword()}
          >
            <Lock size={14} /> {vm.savingPassword ? "Alterando..." : "Alterar senha"}
          </Button>
        </div>
      </section>

      {/* Security note */}
      <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5 }}>
        <strong>Segurança:</strong> Autenticação multifator (2FA/MFA) estará disponível em breve para proteção adicional da sua conta.
      </div>
    </>
  );
}
