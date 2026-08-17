import React from "react";
import { Settings, Lock } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { useAccountSettingsPage } from "./useAccountSettingsPage.js";

export function AccountSettingsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useAccountSettingsPage({ me: props.me, apiBaseUrl: props.apiBaseUrl });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="page-lead">Login necessário para acessar configurações da conta.</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow"><Settings size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />Conta</span>
          <h1>Configurações</h1>
          <p className="page-lead">Gerencie seus dados pessoais e credenciais de acesso.</p>
        </div>
      </header>

      {vm.message ? (
        <p className={`panel ${vm.message.kind === "ok" ? "panel-ok" : "panel-warn"}`}>{vm.message.text}</p>
      ) : null}

      {/* Profile section */}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Dados pessoais</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Nome completo</label>
            <input
              type="text"
              placeholder="Seu nome"
              value={vm.form.name}
              onChange={(e) => vm.setForm((f) => ({ ...f, name: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Email</label>
            <input
              type="email"
              placeholder="seu@email.com"
              value={vm.form.email}
              onChange={(e) => vm.setForm((f) => ({ ...f, email: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Celular / WhatsApp</label>
            <input
              type="tel"
              placeholder="(11) 99999-9999"
              value={vm.form.phone}
              onChange={(e) => vm.setForm((f) => ({ ...f, phone: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" arrow disabled={vm.saving || !vm.form.name.trim() || !vm.form.email.trim()} onClick={() => void vm.saveProfile()}>
            {vm.saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </section>

      {/* Password section */}
      <section className="panel stacked" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h2>Alterar senha</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Senha atual</label>
            <input
              type="password"
              placeholder="••••••••"
              value={vm.passwordForm.currentPassword}
              onChange={(e) => vm.setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Nova senha</label>
            <input
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={vm.passwordForm.newPassword}
              onChange={(e) => vm.setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6 }}>Confirmar nova senha</label>
            <input
              type="password"
              placeholder="Repita a nova senha"
              value={vm.passwordForm.confirmPassword}
              onChange={(e) => vm.setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
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
