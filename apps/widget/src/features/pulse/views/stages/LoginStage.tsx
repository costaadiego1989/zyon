import type { StageProps } from '../types';
import { stateBool, stateFn, stateRef, stateStr, stateStyle } from '../types';
import React from 'react';

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
        justifyContent: 'center',
        textAlign: 'center',
        padding: '34px 30px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-60px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '300px',
          height: '300px',
          borderRadius: '50%',
          background: '#1ED760',
          filter: 'blur(80px)',
          opacity: 0.26,
          animation: 'orbSpin 22s linear infinite',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontFamily: "'Space Mono',monospace",
          fontSize: '10px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: 'var(--mut)',
          marginBottom: '8px',
        }}
      >
        Pulse · checkout seguro
      </div>
      <div style={{ fontSize: '25px', fontWeight: 700, letterSpacing: '-.5px', marginBottom: '8px' }}>
        Entrar com seu rosto
      </div>
      <div
        style={{
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--mut)',
          maxWidth: '280px',
          marginBottom: '26px',
        }}
      >
        Reconhecimento facial para comprar sem digitar senha. Rápido, biométrico e só seu.
      </div>

      <div style={stateStyle(s, 'camWrapStyle')}>
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
            stroke="#1ED760"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="295.3"
            strokeDashoffset={faceDash}
            style={{ transition: 'stroke-dashoffset .28s linear' }}
          />
          <defs>
            <linearGradient id="pulseGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1ED760" />
              <stop offset="1" stopColor="#1ED760" />
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '20px', margin: '22px 0', fontSize: '12.5px', color: 'var(--mut)' }}>
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

      {stateBool(s, 'isLogin') && stateStr(s, 'phoneStep') !== 'done' && (
        <div style={{ width: '100%', maxWidth: '280px', marginTop: '24px' }}>
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
