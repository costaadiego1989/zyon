import type { CartRow, StageProps } from '../types';
import { stateBool, stateFn, stateStr, stateStyle, type PointerHandler } from '../types';

export function SmartCartSheet({ s }: StageProps) {
  const cartRows = s.cartRows as CartRow[];
  const agentName = stateStr(s, 'agentName');
  const startDrag = s.startDrag as PointerHandler;

  return (
    <>
      <div onClick={stateFn(s, 'closeCart')} style={stateStyle(s, 'scrimStyle')} role="presentation" />

      <div style={stateStyle(s, 'sheetStyle')}>
        <div
          onPointerDown={startDrag}
          style={{ height: '74px', padding: '9px 18px 0', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
        >
          <div style={{ width: '38px', height: '4px', borderRadius: '4px', background: 'var(--mut)', opacity: 0.4, margin: '0 auto 11px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <span
              style={{
                position: 'relative',
                width: '30px',
                height: '30px',
                borderRadius: '9px',
                background: 'var(--chip)',
                border: '1px solid var(--bd)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6h15l-1.5 9h-12z" />
                <path d="M6 6L5 3H2" />
                <circle cx="9" cy="20" r="1.4" />
                <circle cx="18" cy="20" r="1.4" />
              </svg>
              {(s.cartCount as number) > 0 && (
                <span className="cart-badge">{s.cartCount as number}</span>
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 600 }}>Smart Cart</span>
                <span
                  style={{
                    fontFamily: "'Space Mono',monospace",
                    fontSize: '8.5px',
                    color: 'var(--g2)',
                    border: '1px solid var(--sheetbd)',
                    borderRadius: '20px',
                    padding: '2px 7px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stateStr(s, 'cartState')}
                </span>
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>Atualizado em tempo real pela {agentName}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-.3px' }}>{stateStr(s, 'totalStr')}</div>
            </div>
            <div style={stateStyle(s, 'chevronStyle')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </div>
          </div>
        </div>

        <div style={{ padding: '4px 18px 20px', overflowY: 'auto', height: 'calc(100% - 74px)' }}>
          {stateBool(s, 'cartEmpty') && (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--mut)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)' }}>Carrinho vazio</div>
              <div style={{ fontSize: '11.5px', marginTop: '4px' }}>Use a busca para escolher um produto.</div>
            </div>
          )}

          {stateBool(s, 'cartHasProduct') && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '15px', background: 'var(--card)', border: '1px solid var(--bd)', marginBottom: '11px' }}>
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '11px',
                    flex: 'none',
                    background: 'repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)',
                    border: '1px solid var(--bd)',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600 }}>{stateStr(s, 'productTitle')}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>Produto selecionado</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <button
                    type="button"
                    onClick={stateFn(s, 'dec')}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '7px',
                      border: '1px solid var(--bd)',
                      background: 'var(--chip)',
                      color: 'var(--tx)',
                      fontSize: '15px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    −
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, minWidth: '12px', textAlign: 'center' }}>{stateStr(s, 'qty')}</span>
                  <button
                    type="button"
                    onClick={stateFn(s, 'inc')}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '7px',
                      border: '1px solid var(--bd)',
                      background: 'var(--chip)',
                      color: 'var(--tx)',
                      fontSize: '15px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {cartRows.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '9px 2px', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--mut)', flex: 1, minWidth: 0, lineHeight: 1.35 }}>{r.label}</span>
                  <span style={r.valStyle}>{r.value}</span>
                </div>
              ))}

              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '12px 2px 0', marginTop: '6px', borderTop: '1px solid var(--bd)' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--mut)' }}>Total final</span>
                <span style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-.4px' }}>{stateStr(s, 'totalStr')}</span>
              </div>

              <button
                type="button"
                onClick={stateFn(s, 'removeProduct')}
                style={{
                  width: '100%',
                  marginTop: '14px',
                  border: '1px solid var(--bd)',
                  background: 'var(--chip)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--mut)',
                  padding: '10px',
                  borderRadius: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
                Remover do carrinho
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
