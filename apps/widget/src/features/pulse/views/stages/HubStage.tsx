import type { OrderItem, SettingGroup, StageProps } from '../types';
import { stateBool, stateFn, stateStr, stateStyle } from '../types';

export function HubStage({ s }: StageProps) {
  const orders = s.orders as OrderItem[];
  const settingGroups = s.settingGroups as SettingGroup[];
  const agentName = stateStr(s, 'agentName');

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '18px 16px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <div
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '14px',
            flex: 'none',
            background: 'var(--g1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '17px',
            fontWeight: 700,
            color: '#fff',
          }}
        >
          {stateStr(s, 'profileInitial')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{stateStr(s, 'profileName')}</div>
          <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '1px' }}>{stateStr(s, 'profileEmail')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '13px', background: 'var(--chip)', border: '1px solid var(--bd)', marginBottom: '16px' }}>
        <button type="button" onClick={stateFn(s, 'setOrdersTab')} style={stateStyle(s, 'ordersTabStyle')}>
          Pedidos
        </button>
        <button type="button" onClick={stateFn(s, 'setSettingsTab')} style={stateStyle(s, 'settingsTabStyle')}>
          Configurações
        </button>
      </div>

      {stateBool(s, 'hubOrders') && (
        <div>
          {stateBool(s, 'recovery') && (
            <div
              style={{
                border: '1px solid var(--g1)',
                borderRadius: '16px',
                padding: '14px',
                background: 'rgba(30,215,96,.08)',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--g3)', animation: 'pulseDot 2s infinite' }} />
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '8.5px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--g3)' }}>
                  Carrinho não finalizado
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '11px',
                    flex: 'none',
                    background: 'repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)',
                    border: '1px solid var(--bd)',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{stateStr(s, 'productTitle')}</div>
                  <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '1px' }}>
                    {stateStr(s, 'recoveryTotal')} · com promoção aplicada
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={stateFn(s, 'resumeCart')}
                style={{
                  width: '100%',
                  marginTop: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: '#fff',
                  padding: '11px',
                  borderRadius: '11px',
                  background: 'var(--g1)',
                }}
              >
                Retomar compra com a {agentName}
              </button>
            </div>
          )}

          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)', marginBottom: '11px' }}>
            Pedidos em todas as lojas globais
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {orders.map((o) => (
              <div key={`${o.store}-${o.amount}`} style={{ border: '1px solid var(--bd)', background: 'var(--card)', borderRadius: '16px', padding: '13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '11px',
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      fontWeight: 700,
                      color: '#fff',
                      background: o.avatarBg,
                    }}
                  >
                    {o.initial}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>{o.store}</span>
                      <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '8px', letterSpacing: '.5px', color: 'var(--mut)', border: '1px solid var(--bd)', borderRadius: '20px', padding: '1px 6px' }}>
                        {o.region}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>{o.items}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700 }}>{o.amount}</div>
                    <div style={o.statusStyle}>{o.status}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stateBool(s, 'hubSettings') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {settingGroups.map((g) => (
            <div key={g.title}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)', marginBottom: '9px' }}>
                {g.title}
              </div>
              <div style={{ border: '1px solid var(--bd)', borderRadius: '15px', overflow: 'hidden' }}>
                {g.rows.map((row) => (
                  <div key={row.label} onClick={row.fn} style={row.style} role="button" tabIndex={0}>
                    <span
                      style={{
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
                      {row.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500 }}>{row.label}</div>
                      <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>{row.value}</div>
                    </div>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
