import type { SupportChip, SupportMsg, StageProps } from '../types';
import { stateBool, stateFn, stateRef, stateStr, type InputHandler, type KeyHandler } from '../types';
import { PulseAgentOrb } from '../components/PulseAgentOrb';

export function SupportPanel({ s }: StageProps) {
  const supportChips = s.supportChips as SupportChip[];
  const supportMsgs = s.supportMsgs as SupportMsg[];
  const supportRef = stateRef<HTMLDivElement>(s, 'supportRef');
  const agentName = stateStr(s, 'agentName');
  const storeName = stateStr(s, 'storeName');
  const supportInput = stateStr(s, 'supportInput');
  const onSupportInput = s.onSupportInput as InputHandler;
  const onSupportKey = s.onSupportKey as KeyHandler;

  return (
    <>
      <div
        onClick={stateFn(s, 'closeSupport')}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 44,
          background: 'rgba(0,0,0,.45)',
          backdropFilter: 'blur(2px)',
          animation: 'overlayIn .2s ease both',
        }}
        role="presentation"
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 45,
          height: '75%',
          background: 'var(--sheet)',
          borderTop: '1px solid var(--sheetbd)',
          borderRadius: '24px 24px 0 0',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 -18px 50px -20px rgba(0,0,0,.5)',
          animation: 'overlayIn .3s ease both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '16px 16px 13px', borderBottom: '1px solid var(--bd)', flex: 'none' }}>
          <PulseAgentOrb placement="support" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600 }}>Suporte {agentName} · IA</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dot)', animation: 'pulseDot 2.2s infinite' }} />
              Respondendo na hora
            </div>
          </div>
          <button
            type="button"
            onClick={stateFn(s, 'closeSupport')}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              border: '1px solid var(--bd)',
              background: 'var(--chip)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              padding: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div ref={supportRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {stateBool(s, 'supportEmpty') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              <div style={{ fontSize: '13.5px', lineHeight: 1.5, color: 'var(--tx)' }}>
                Oi! Sou o suporte da {storeName} com IA. Em que posso ajudar com o seu pedido?
              </div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)', marginTop: '9px' }}>
                Perguntas frequentes
              </div>
              {supportChips.map((ch) => (
                <button
                  key={ch.label}
                  type="button"
                  onClick={ch.fn}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '12.5px',
                    color: 'var(--tx)',
                    background: 'var(--card)',
                    border: '1px solid var(--bd)',
                    borderRadius: '12px',
                    padding: '11px 13px',
                  }}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          )}
          {supportMsgs.map((sm, i) => (
            <div key={i} style={sm.rowStyle}>
              <div style={sm.bubbleStyle}>{sm.text}</div>
            </div>
          ))}
          {stateBool(s, 'supportTyping') && (
            <div style={{ display: 'flex', gap: '4px', padding: '12px 14px', borderRadius: '16px 16px 16px 4px', background: 'var(--card)', border: '1px solid var(--bd)', width: 'fit-content', marginTop: '10px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s infinite' }} />
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s .2s infinite' }} />
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s .4s infinite' }} />
            </div>
          )}
        </div>

        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: '9px', flex: 'none' }}>
          <input
            value={supportInput}
            onChange={onSupportInput}
            onKeyDown={onSupportKey}
            placeholder="Escreva sua dúvida…"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'var(--chip)',
              border: '1px solid var(--bd)',
              borderRadius: '12px',
              padding: '11px 13px',
              outline: 'none',
              color: 'var(--tx)',
              fontSize: '13px',
            }}
          />
          <button
            type="button"
            onClick={stateFn(s, 'sendSupport')}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '11px',
              border: 'none',
              cursor: 'pointer',
              background: 'var(--g1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              padding: 0,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
