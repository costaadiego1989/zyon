"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { AGENT_AVATAR_COLORS, AGENT_AVATAR_EXPRESSIONS, AGENT_AVATAR_STYLES, type ShoppingAgentAppearance } from "@zyon/shared-types";
import { AgentAvatar, AgentIcon, AVATAR_COLORS, AVATAR_EXPRESSIONS, AVATAR_STYLES } from "./AgentAvatar";
import styles from "./AgentAppearanceStudio.module.css";

export default function AgentAppearanceStudio({ name: initialName, appearance: initialAppearance, creating, onSave, onCancel }: {
  name: string; appearance: ShoppingAgentAppearance; creating: boolean;
  onSave: (name: string, appearance: ShoppingAgentAppearance) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [appearance, setAppearance] = useState(initialAppearance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { await onSave(name.trim(), appearance); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar seu visual. Tente novamente."); setBusy(false); }
  };
  return <form className={styles.studio} onSubmit={save} aria-label="Personalizar aparência do agente">
    <header className={styles.header}><button type="button" onClick={onCancel} disabled={busy}><AgentIcon name="back" />Voltar</button>
      <h2 ref={heading} tabIndex={-1}>Do seu jeito.</h2><p>Uma presença que combina com você.</p></header>
    <div className={styles.preview} aria-label="Prévia do agente">
      <div className={styles.portrait}><AgentAvatar name={name || "Meu agente"} appearance={appearance} size={152} /></div>
      <strong>{name.trim() || "Meu agente"}</strong><span>Seu assistente pessoal de compras</span>
    </div>
    <label className={styles.name}>Nome do agente<input required maxLength={60} autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
    <fieldset><legend>Escolha uma presença</legend><div className={styles.styles}>
      {AGENT_AVATAR_STYLES.map(style => <label key={style} className={styles.styleOption}>
        <input type="radio" name="avatar-style" value={style} checked={appearance.style === style} onChange={() => setAppearance(current => ({ ...current, style }))} />
        <span className={styles.styleTile}><AgentAvatar name={name || "Meu agente"} appearance={{ ...appearance, style }} size={64} decorative /><span>{AVATAR_STYLES[style]}</span></span>
      </label>)}
    </div></fieldset>
    <fieldset><legend>Sua cor</legend><div className={styles.colors}>
      {AGENT_AVATAR_COLORS.map(color => <label key={color} className={styles.colorOption} style={{ "--avatar-color": AVATAR_COLORS[color].base } as CSSProperties}>
        <input type="radio" name="avatar-color" value={color} aria-label={AVATAR_COLORS[color].label} checked={appearance.color === color} onChange={() => setAppearance(current => ({ ...current, color }))} />
        <span className={styles.swatch}>{appearance.color === color && <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="white" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}</span>
        <span>{AVATAR_COLORS[color].label}</span>
      </label>)}
    </div></fieldset>
    <fieldset disabled={appearance.style === "initials"}><legend>Expressão</legend><div className={styles.expressions}>
      {AGENT_AVATAR_EXPRESSIONS.map(expression => <label key={expression}>
        <input type="radio" name="avatar-expression" value={expression} checked={appearance.expression === expression} onChange={() => setAppearance(current => ({ ...current, expression }))} />
        <span>{AVATAR_EXPRESSIONS[expression]}</span>
      </label>)}
    </div>{appearance.style === "initials" && <p className={styles.help}>O estilo Inicial usa as letras do nome escolhido.</p>}</fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.footer}><p>{creating ? "O visual será salvo quando você criar seu agente." : "O visual fica salvo para seu agente nesta loja."}</p>
      <div><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" className={styles.save} data-neu="primary" disabled={busy || !name.trim()}>{busy ? "Salvando…" : creating ? "Usar este visual" : "Salvar visual"}<AgentIcon name="arrow" /></button></div>
    </footer>
  </form>;
}
