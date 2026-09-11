import React, { useEffect, useRef } from "react";
import { ArrowUpRight, Check, ArrowLeft } from "lucide-react";
import { SignupWizard, type SignupWizardProps } from "./SignupWizard.js";
import "./signup-experience.css";

type AuthExperienceProps = {
  mode: "signup" | "login" | "forgot" | "reset";
  busy: boolean;
  onSwitchMode: (mode: "signup" | "login") => void;
  children: React.ReactNode;
};

export function AuthExperience({ mode, busy, onSwitchMode, children }: AuthExperienceProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current !== mode) {
      const heading = formRef.current?.querySelector("h2");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
    }
    previousMode.current = mode;
  }, [mode]);
  const isSignup = mode === "signup";
  const isLogin = mode === "login";
  return <main className="signup-experience" data-auth-mode={mode}>
    <div className="signup-experience__layout">
      <section className="signup-story" aria-labelledby="signup-story-title">
        <header className="signup-story__brand"><a href="https://www.zyon-payments.com.br/" aria-label="Zyon, voltar ao site"><img src="/logo-zyon.png" alt="Zyon" /></a><span>Sua loja autônoma com IA</span></header>
        <div className="signup-story__copy"><span className="signup-story__eyebrow">Seu próximo capítulo começa aqui</span><h1 id="signup-story-title">Sua loja,<br /><em>em ação.</em><br />Você, no comando.</h1><p>Do primeiro “olá” ao próximo pedido. A Zyon conecta atendimento, catálogo e compra, com as regras do seu negócio.</p></div>
        <figure className="signup-story__product"><div><span><i></i> Seu centro de operação</span><ArrowUpRight size={16} /></div><img src="/signup-dashboard.webp" alt="Visão geral do dashboard Zyon, com pedidos e gráficos. Dados ilustrativos." width="2160" height="1440" /><figcaption>Interface real · Dados ilustrativos</figcaption></figure>
        <div className="signup-story__offer"><Check size={18} /><p><strong>14 dias sem taxa Zyon para a loja no Free.</strong><span>Após o cadastro, escolha seu plano e confira as condições.</span></p></div>
      </section>
      <section className="signup-workspace" aria-label={isSignup ? "Cadastro da sua loja" : isLogin ? "Acesso à sua loja" : "Recuperação de acesso"}>
        <nav className="signup-workspace__nav" aria-label="Acesso"><a href="https://www.zyon-payments.com.br/"><ArrowLeft size={15} /> Voltar ao site</a><span>{isSignup ? "Já tem conta?" : isLogin ? "Ainda não tem conta?" : "Lembrou sua senha?"} <button type="button" onClick={() => onSwitchMode(isLogin ? "signup" : "login")} disabled={busy}>{isLogin ? "Criar conta" : "Entrar"} <ArrowUpRight size={14} /></button></span></nav>
        <div className="signup-workspace__form" ref={formRef}><div className="auth-mode-content" key={mode}>{children}</div></div>
        <footer className="signup-workspace__footer"><span>Você mantém o controle da sua operação.</span><a href="https://www.zyon-payments.com.br/privacidade" target="_blank" rel="noreferrer">Privacidade</a></footer>
      </section>
    </div>
  </main>;
}

export function SignupExperience(props: SignupWizardProps) {
  return <AuthExperience mode="signup" busy={props.busy} onSwitchMode={props.onSwitchToLogin}><SignupWizard {...props} /></AuthExperience>;
}
