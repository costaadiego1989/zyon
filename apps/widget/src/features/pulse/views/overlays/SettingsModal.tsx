import type { CurrencyOpt, Draft, LangOpt, NotifRow, PayOpt, StageProps } from '../types';
import { stateBool, stateFn, stateStr, type InputHandler } from '../types';

export function SettingsModal({ s }: StageProps) {
  const d = s.d as Draft;
  const payOpts = s.payOpts as PayOpt[];
  const currencyOpts = s.currencyOpts as CurrencyOpt[];
  const langOpts = s.langOpts as LangOpt[];
  const notifRows = s.notifRows as NotifRow[];
  const securityRows = s.securityRows as NotifRow[];

  const onDraftName = s.onDraftName as InputHandler;
  const onDraftEmail = s.onDraftEmail as InputHandler;
  const onDraftPhone = s.onDraftPhone as InputHandler;
  const onDraftCep = s.onDraftCep as InputHandler;
  const onDraftNumber = s.onDraftNumber as InputHandler;
  const onDraftComplement = s.onDraftComplement as InputHandler;

  return (
    <>
      <div
        onClick={stateFn(s, 'closeModal')}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 54,
          background: 'rgba(0,0,0,.5)',
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
          zIndex: 55,
          maxHeight: '86%',
          background: 'var(--sheet)',
          borderTop: '1px solid var(--sheetbd)',
          borderRadius: '24px 24px 0 0',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 -18px 50px -20px rgba(0,0,0,.5)',
          animation: 'overlayIn .3s ease both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '17px 16px 14px', borderBottom: '1px solid var(--bd)', flex: 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>{stateStr(s, 'modalTitle')}</div>
            <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>{stateStr(s, 'modalSub')}</div>
          </div>
          <button
            type="button"
            onClick={stateFn(s, 'closeModal')}
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {stateBool(s, 'mProfile') && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Nome completo</span>
                <input value={d.name} onChange={onDraftName} style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>E-mail</span>
                <input value={d.email} onChange={onDraftEmail} inputMode="email" style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Telefone</span>
                <input value={d.phone} onChange={onDraftPhone} inputMode="tel" style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
            </>
          )}

          {stateBool(s, 'mAddress') && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>CEP</span>
                <input value={d.cep} onChange={onDraftCep} inputMode="numeric" style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Número</span>
                <input value={d.number} onChange={onDraftNumber} inputMode="numeric" style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Complemento</span>
                <input value={d.complement} onChange={onDraftComplement} style={{ background: 'var(--chip)', border: '1px solid var(--bd)', borderRadius: '12px', padding: '12px 14px', outline: 'none', color: 'var(--tx)', fontSize: '14px', fontFamily: 'inherit' }} />
              </label>
            </>
          )}

          {stateBool(s, 'mPayment') && (
            <>
              {payOpts.map((o) => (
                <button key={o.label} type="button" onClick={o.fn} style={o.style}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--tx)' }}>{o.label}</span>
                    <span style={{ fontSize: '11px', color: 'var(--mut)' }}>{o.sub}</span>
                  </span>
                  {o.active && (
                    <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--g1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                style={{
                  marginTop: '2px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: 'var(--mut)',
                  border: '1px dashed var(--bd)',
                  background: 'transparent',
                  borderRadius: '12px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Adicionar cartão
              </button>
            </>
          )}

          {stateBool(s, 'mLocale') && (
            <>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Moeda</div>
              {currencyOpts.map((o) => (
                <button key={o.code} type="button" onClick={o.fn} style={o.style}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '12px', fontWeight: 700, color: 'var(--tx)' }}>{o.code}</span>
                    <span style={{ fontSize: '12.5px', color: 'var(--mut)' }}>{o.label}</span>
                  </span>
                  {o.active && <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--g1)', flex: 'none' }} />}
                </button>
              ))}
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)', marginTop: '6px' }}>Idioma</div>
              {langOpts.map((o) => (
                <button key={o.code} type="button" onClick={o.fn} style={o.style}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--tx)' }}>{o.label}</span>
                  {o.active && <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--g1)', flex: 'none' }} />}
                </button>
              ))}
            </>
          )}

          {stateBool(s, 'mNotif') &&
            notifRows.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px', border: '1px solid var(--bd)', borderRadius: '13px', background: 'var(--card)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.label}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '2px' }}>{r.sub}</div>
                </div>
                <button type="button" onClick={r.fn} style={r.switchStyle}>
                  <span style={r.knobStyle} />
                </button>
              </div>
            ))}

          {stateBool(s, 'mSecurity') &&
            securityRows.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px', border: '1px solid var(--bd)', borderRadius: '13px', background: 'var(--card)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.label}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '2px' }}>{r.sub}</div>
                </div>
                <button type="button" onClick={r.fn} style={r.switchStyle}>
                  <span style={r.knobStyle} />
                </button>
              </div>
            ))}
        </div>

        {stateBool(s, 'modalSavable') && (
          <div style={{ padding: '13px 16px 16px', borderTop: '1px solid var(--bd)', flex: 'none' }}>
            <button
              type="button"
              onClick={stateFn(s, 'saveModal')}
              style={{
                width: '100%',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '13.5px',
                fontWeight: 600,
                color: '#fff',
                padding: '13px',
                borderRadius: '13px',
                background: 'var(--g1)',
              }}
            >
              Salvar alterações
            </button>
          </div>
        )}
      </div>
    </>
  );
}
