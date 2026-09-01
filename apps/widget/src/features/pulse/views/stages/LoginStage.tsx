import type { StageProps } from '../types';
import { stateBool, stateFn, stateRef, stateStr, stateStyle } from '../types';
import React, { useState } from 'react';

function isValidCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (Number(digits[9]) !== d1) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return Number(digits[10]) === d2;
}

function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function CompleteProfileForm({
  onSubmit,
}: {
  onSubmit: (
    name: string,
    cpf: string,
    email: string,
    dateOfBirth?: string,
    gender?: string
  ) => void;
}) {
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [cpfError, setCpfError] = useState('');

  const handleSubmit = () => {
    const cleanCpf = cpf.replace(/\D/g, '');
    if (!isValidCpf(cleanCpf)) { setCpfError('CPF inválido'); return; }
    setCpfError('');
    onSubmit(
      name.trim(),
      cleanCpf,
      email.trim(),
      dateOfBirth || undefined,
      gender || undefined
    );
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'var(--chip)',
    border: '1px solid var(--bd)', borderRadius: '12px', padding: '13px 14px',
    fontSize: '14px', fontFamily: 'inherit', color: 'var(--tx)', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, textAlign: 'center', marginBottom: '2px' }}>
        Complete seu cadastro
      </div>
      <div style={{ fontSize: '11px', color: 'var(--mut)', textAlign: 'center', marginBottom: '4px' }}>
        Precisamos de mais alguns dados para finalizar sua compra
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome completo"
        style={inputStyle}
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-mail"
        style={inputStyle}
      />
      <input
        type="text"
        inputMode="numeric"
        value={cpf}
        onChange={(e) => { setCpf(formatCpf(e.target.value)); setCpfError(''); }}
        placeholder="CPF (000.000.000-00)"
        style={{ ...inputStyle, ...(cpfError ? { borderColor: '#ef4444' } : {}) }}
      />
      {cpfError && <div style={{ fontSize: '11px', color: '#ef4444', textAlign: 'center' }}>{cpfError}</div>}
      <label style={{ fontSize: '11px', color: 'var(--mut)' }}>Data de nascimento (opcional)</label>
      <input
        type="date"
        value={dateOfBirth}
        onChange={(e) => setDateOfBirth(e.target.value)}
        style={inputStyle}
      />
      <label style={{ fontSize: '11px', color: 'var(--mut)' }}>Gênero (opcional)</label>
      <select
        value={gender}
        onChange={(e) => setGender(e.target.value)}
        style={inputStyle}
      >
        <option value="">Selecione</option>
        <option value="feminino">Feminino</option>
        <option value="masculino">Masculino</option>
        <option value="nao_binario">Não-binário</option>
        <option value="outro">Outro</option>
        <option value="prefiro_nao_informar">Prefiro não informar</option>
      </select>
      <button
        type="button"
        disabled={!name.trim() || !email.includes('@') || cpf.replace(/\D/g, '').length !== 11}
        onClick={handleSubmit}
        style={{
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: '14px', fontWeight: 600, color: '#fff', padding: '13px',
          borderRadius: '12px', background: 'var(--g1)', width: '100%',
          opacity: (!name.trim() || !email.includes('@') || cpf.replace(/\D/g, '').length !== 11) ? 0.5 : 1,
        }}
      >
        Continuar
      </button>
    </div>
  );
}

export function LoginStage({ s }: StageProps) {
  const camRef = stateRef<HTMLVideoElement>(s, 'camRef');
  const faceDash = stateStr(s, 'faceDash');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '0 30px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* spacer pushes content to vertical center when there's room */}
      <div style={{ flex: '1 1 0', minHeight: '16px' }} />
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--mut)', marginBottom: '12px', textAlign: 'center', width: '100%' }}>
        Pulse · checkout seguro
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-.5px', lineHeight: 1.2, marginBottom: '12px', textAlign: 'center', width: '100%' }}>
        Entrar com seu rosto
      </div>
      <div
        style={{
          fontSize: '13px',
          lineHeight: 1.55,
          color: 'var(--mut)',
          maxWidth: '380px',
          marginBottom: '24px',
          textAlign: 'center',
        }}
      >
        Reconhecimento facial para comprar sem digitar senha. Rápido, biométrico e só seu.
      </div>

      <div style={{ ...stateStyle(s, 'camWrapStyle'), margin: '0 auto' }}>
        <video
          ref={camRef}
          autoPlay
          muted
          playsInline
          style={stateStyle(s, 'camVideoStyle')}
        />
        {stateBool(s, 'camIdle') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              background: 'var(--chip)',
            }}
          >
            <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
              <circle cx="12" cy="11" r="3" />
              <path d="M7 18c1-2.6 3-3.6 5-3.6s4 1 5 3.6" />
            </svg>
          </div>
        )}
        <span style={{ position: 'absolute', top: '16px', left: '16px', width: '24px', height: '24px', borderTop: '2.5px solid var(--g2)', borderLeft: '2.5px solid var(--g2)', borderRadius: '6px 0 0 0' }} />
        <span style={{ position: 'absolute', top: '16px', right: '16px', width: '24px', height: '24px', borderTop: '2.5px solid var(--g2)', borderRight: '2.5px solid var(--g2)', borderRadius: '0 6px 0 0' }} />
        <span style={{ position: 'absolute', bottom: '16px', left: '16px', width: '24px', height: '24px', borderBottom: '2.5px solid var(--g2)', borderLeft: '2.5px solid var(--g2)', borderRadius: '0 0 0 6px' }} />
        <span style={{ position: 'absolute', bottom: '16px', right: '16px', width: '24px', height: '24px', borderBottom: '2.5px solid var(--g2)', borderRight: '2.5px solid var(--g2)', borderRadius: '0 0 6px 0' }} />
        {stateBool(s, 'faceScanning') && (
          <div
            style={{
              position: 'absolute',
              left: '12%',
              right: '12%',
              height: '2px',
              background: 'linear-gradient(90deg,transparent,var(--g2),transparent)',
              boxShadow: '0 0 12px var(--g2)',
              animation: 'scanSweep 1.6s ease-in-out infinite',
            }}
          />
        )}
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: '-7px', width: 'calc(100% + 14px)', height: 'calc(100% + 14px)', transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="47" fill="none" stroke="var(--bd)" strokeWidth="2.4" />
          <circle
            cx="50"
            cy="50"
            r="47"
            fill="none"
            stroke="var(--aacp-accent, #0f766e)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="295.3"
            strokeDashoffset={faceDash}
            style={{ transition: 'stroke-dashoffset .28s linear' }}
          />
          <defs>
            <linearGradient id="pulseGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--aacp-accent, #0f766e)" />
              <stop offset="1" stopColor="var(--aacp-accent, #0f766e)" />
            </linearGradient>
          </defs>
        </svg>
        {stateBool(s, 'faceSuccess') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(8,8,12,.4)',
              borderRadius: '50%',
              backdropFilter: 'blur(2px)',
            }}
          >
            <span
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'var(--g1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '20px', margin: '22px 0', fontSize: '12.5px', color: 'var(--mut)', width: '100%' }}>
        {stateBool(s, 'faceBusy') && (
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '2px solid var(--g2)',
              borderTopColor: 'transparent',
              animation: 'ringSpin .8s linear infinite',
              flex: 'none',
            }}
          />
        )}
        {stateStr(s, 'faceHint')}
      </div>

      <button type="button" onClick={stateFn(s, 'startFace')} style={stateStyle(s, 'faceBtnStyle')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="11" r="2.4" />
          <path d="M8.5 16.5c.8-1.6 2-2.3 3.5-2.3s2.7.7 3.5 2.3" />
        </svg>
        {stateStr(s, 'faceBtnLabel')}
      </button>
      <button
        type="button"
        onClick={stateFn(s, 'skipLogin')}
        style={{
          marginTop: '13px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '12px',
          fontWeight: 500,
          color: 'var(--mut)',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
        }}
      >
        Iniciar como visitante
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--mut)', marginTop: '22px' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Processado no dispositivo · sua imagem não é enviada
      </div>

      {/* bottom spacer to balance the top flex spacer */}
      <div style={{ flex: '1 1 0', minHeight: '20px' }} />

      {stateBool(s, 'isLogin') && stateStr(s, 'phoneStep') !== 'done' && (
        <div style={{ width: '100%', maxWidth: '280px', marginTop: '0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--bd)' }} />
            <span style={{ fontSize: '11px', color: 'var(--mut)', fontFamily: "'Space Mono',monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>ou</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--bd)' }} />
          </div>

          {(stateStr(s, 'phoneStep') === 'idle' || stateStr(s, 'phoneStep') === 'enter_phone') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, textAlign: 'center', marginBottom: '2px' }}>
                Entrar com telefone
              </div>
              <input
                type="tel"
                value={stateStr(s, 'phoneNumber')}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const fn = s['onPhoneInput'] as (v: string) => void;
                  fn(e.target.value);
                }}
                placeholder="+55 (11) 99999-9999"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--chip)',
                  border: '1px solid var(--bd)',
                  borderRadius: '12px',
                  padding: '13px 14px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  color: 'var(--tx)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={stateFn(s, 'submitPhone') as unknown as () => void}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#fff',
                  padding: '13px',
                  borderRadius: '12px',
                  background: 'var(--g1)',
                  width: '100%',
                }}
              >
                Receber código
              </button>
            </div>
          )}

          {stateStr(s, 'phoneStep') === 'enter_code' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, textAlign: 'center', marginBottom: '2px' }}>
                Código enviado para {stateStr(s, 'phoneNumber')}
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={stateStr(s, 'phoneCode')}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const fn = s['onPhoneCodeInput'] as (v: string) => void;
                  fn(e.target.value);
                }}
                placeholder="000000"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--chip)',
                  border: '1px solid var(--bd)',
                  borderRadius: '12px',
                  padding: '13px 14px',
                  fontSize: '22px',
                  fontFamily: "'Space Mono',monospace",
                  letterSpacing: '6px',
                  color: 'var(--tx)',
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={stateFn(s, 'submitCode') as unknown as () => void}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#fff',
                  padding: '13px',
                  borderRadius: '12px',
                  background: 'var(--g1)',
                  width: '100%',
                }}
              >
                Verificar
              </button>
            </div>
          )}

          {stateStr(s, 'phoneStep') === 'verifying' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px 0', color: 'var(--mut)', fontSize: '13px' }}>
              <span
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  border: '2px solid var(--g2)',
                  borderTopColor: 'transparent',
                  animation: 'ringSpin .8s linear infinite',
                  flex: 'none',
                }}
              />
              Verificando…
            </div>
          )}

          {stateStr(s, 'phoneStep') === 'complete_profile' && (
            <CompleteProfileForm
              onSubmit={(name, cpf, email, dateOfBirth, gender) => {
                const fn = s['completeProfile'] as (
                  n: string,
                  c: string,
                  e: string,
                  dob?: string,
                  g?: string
                ) => void;
                fn(name, cpf, email, dateOfBirth, gender);
              }}
            />
          )}

          {stateStr(s, 'phoneError') && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444', textAlign: 'center', lineHeight: 1.4 }}>
              {stateStr(s, 'phoneError')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
