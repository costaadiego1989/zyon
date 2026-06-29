import type { IntroCap, StageProps } from '../types';
import { stateBool, stateFn, stateStr } from '../types';
import { PulseAgentOrb } from '../components/PulseAgentOrb';

export function IntroStage({ s }: StageProps) {
  const introCaps = s.introCaps as IntroCap[];
  const storeName = stateStr(s, 'storeName');
  const agentName = stateStr(s, 'agentName');

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
        padding: '28px 24px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-50px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '220px',
          height: '220px',
          borderRadius: '50%',
          background: '#1ED760',
          filter: 'blur(80px)',
          opacity: 0.22,
          pointerEvents: 'none',
        }}
      />

      <div style={{ marginBottom: '20px' }}>
        <PulseAgentOrb placement="intro" />
      </div>

      <div
        style={{
          fontFamily: "'Space Mono',monospace",
          fontSize: '10px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: 'var(--mut)',
          marginBottom: '10px',
        }}
      >
        Gerente de vendas da {storeName}
      </div>
      <div style={{ fontSize: '27px', fontWeight: 700, letterSpacing: '-.5px', marginBottom: '10px' }}>
        Oi, eu sou a {agentName}.
      </div>
      <div style={{ fontSize: '13.5px', lineHeight: 1.55, color: 'var(--mut)', maxWidth: '300px', marginBottom: '22px' }}>
        Eu cuido da sua compra do início ao fim — acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginBottom: '24px' }}>
        {introCaps.map((cap) => (
          <div
            key={cap.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              padding: '11px 14px',
              borderRadius: '13px',
              background: 'var(--card)',
              border: '1px solid var(--bd)',
            }}
          >
            <span
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '8px',
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: cap.tint,
              }}
            >
              {cap.icon}
            </span>
            <span style={{ fontSize: '12.5px', fontWeight: 500, textAlign: 'left', lineHeight: 1.35 }}>{cap.label}</span>
          </div>
        ))}
      </div>

      {stateBool(s, 'voiceEnabled') && (
        <>
          <div
            style={{
              fontFamily: "'Space Mono',monospace",
              fontSize: '9px',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color: 'var(--mut)',
              marginBottom: '11px',
            }}
          >
            Como você prefere comprar?
          </div>
          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <button
              type="button"
              onClick={stateFn(s, 'startChat')}
              style={{
                flex: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                border: '1px solid var(--bd)',
                background: 'var(--card)',
                borderRadius: '16px',
                padding: '15px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '9px',
              }}
            >
              <span
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '11px',
                  background: 'var(--g1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
                </svg>
              </span>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--tx)' }}>Por chat</span>
              <span style={{ fontSize: '10.5px', color: 'var(--mut)', lineHeight: 1.3 }}>Converse digitando</span>
            </button>
            <button
              type="button"
              onClick={stateFn(s, 'startVoiceChat')}
              style={{
                flex: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                border: '1px solid var(--g1)',
                background: 'rgba(30,215,96,.08)',
                borderRadius: '16px',
                padding: '15px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '9px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '9px',
                  right: '9px',
                  fontFamily: "'Space Mono',monospace",
                  fontSize: '7.5px',
                  letterSpacing: '.5px',
                  color: 'var(--g2)',
                  border: '1px solid var(--g2)',
                  borderRadius: '5px',
                  padding: '1px 4px',
                }}
              >
                IA
              </span>
              <span
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '11px',
                  background: 'var(--g1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </span>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--tx)' }}>Por voz</span>
              <span style={{ fontSize: '10.5px', color: 'var(--mut)', lineHeight: 1.3 }}>Fale com a {agentName}</span>
            </button>
          </div>
        </>
      )}

      {stateBool(s, 'voiceDisabled') && (
        <button
          type="button"
          onClick={stateFn(s, 'startChat')}
          style={{
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '14px',
            fontWeight: 600,
            color: '#fff',
            padding: '14px 22px',
            borderRadius: '14px',
            background: 'var(--g1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
          }}
        >
          Começar a comprar
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
