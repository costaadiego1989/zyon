import type { ActionItem, MessageRender, StageProps } from '../types';
import {
  stateBool,
  stateFn,
  stateRef,
  stateStr,
  stateStyle,
  type InputHandler,
  type KeyHandler,
} from '../types';
import { AgentAvatar } from '../components/AgentAvatar';
import { PulseAgentOrb } from '../components/PulseAgentOrb';
import { ShimmerBorder } from '../components/ShimmerBorder';
import { useMetaMaskPayment } from '../../hooks/useMetaMaskPayment';
import { safeExternalUrl } from '../../../../lib/safe-url.js';

// Demo merchant Stellar address — replace with real value from merchant config
const DEMO_MERCHANT_STELLAR = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const METAMASK_STATUS_LABEL: Record<string, string> = {
  idle: 'Pagar com MetaMask (USDC · Base → Stellar)',
  connecting: 'Conectando carteira…',
  approving: 'Aprovando USDC…',
  burning: 'Enviando USDC via CCTP…',
  submitted: 'Enviado!',
  error: 'Tentar novamente',
};

export function ChatMessages({ s }: StageProps) {
  const { status: mmStatusRaw, txHash: mmTxHash, error: mmError, payWithMetaMask } = useMetaMaskPayment();
  const mmStatus: string = mmStatusRaw;
  const cryptoUsdc = stateStr(s, 'cryptoUsdc');
  const merchantStellar = (s.merchantStellarAddress as string | undefined) ?? DEMO_MERCHANT_STELLAR;
  const messages = s.messages as MessageRender[];
  const actions = s.actions as ActionItem[];
  const chatRef = stateRef<HTMLDivElement>(s, 'chatRef');
  const storeName = stateStr(s, 'storeName');
  const fieldValue = stateStr(s, 'fieldValue');
  const fieldProgress = stateStr(s, 'fieldProgress');
  const fieldPlaceholderLive = stateStr(s, 'fieldPlaceholderLive');
  const fieldMicColor = stateStr(s, 'fieldMicColor');
  const onFieldInput = s.onFieldInput as InputHandler;
  const onFieldKey = s.onFieldKey as KeyHandler;

  return (
    <div ref={chatRef} style={stateStyle(s, 'chatStyle')}>
      {messages.map((m, i) => (
        <div key={i} style={m.rowStyle}>
          {m.showAvatar && <AgentAvatar active={!!m.isCurrentAgent} />}
          {m.spacerAvatar && <div style={{ width: '26px', flex: 'none' }} />}

          <div style={m.wrapStyle}>
            {m.isText && <div style={m.bubbleStyle}>{m.text}</div>}

            {m.isProduct && (
              <ShimmerBorder radius="18px">
                <div style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                    <span
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '6px',
                        background: 'var(--chip)',
                        border: '1px solid var(--bd)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 'none',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--g2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 6h15l-1.5 9h-12z" />
                        <path d="M6 6L5 3H2" />
                      </svg>
                    </span>
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '8.5px', letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--mut)' }}>
                      No seu carrinho · {storeName}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '13px' }}>
                    <div
                      style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '14px',
                        flex: 'none',
                        background: 'repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 7px,var(--tile2) 7px,var(--tile2) 14px)',
                        border: '1px solid var(--bd)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 600 }}>{stateStr(s, 'productTitle')}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--mut)', lineHeight: 1.4, marginTop: '3px' }}>{stateStr(s, 'productSubtitle')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <div style={{ fontSize: '15px', fontWeight: 700 }}>{stateStr(s, 'productPrice')}</div>
                      <div style={{ fontSize: '10px', color: 'var(--mut)', marginTop: '1px' }}>em estoque</div>
                    </div>
                  </div>
                </div>
              </ShimmerBorder>
            )}

            {m.isCoupon && (
              <div>
                <ShimmerBorder radius="16px" innerStyle={{ background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 18%, transparent)' }}>
                  <div style={{ position: 'relative', display: 'flex', overflow: 'hidden' }}>
                    <span style={{ position: 'absolute', left: '112px', top: '-7px', width: '14px', height: '14px', borderRadius: '50%', background: 'var(--bg)', transform: 'translateX(-50%)' }} />
                    <span style={{ position: 'absolute', left: '112px', bottom: '-7px', width: '14px', height: '14px', borderRadius: '50%', background: 'var(--bg)', transform: 'translateX(-50%)' }} />
                    <div
                      style={{
                        width: '112px',
                        flex: 'none',
                        padding: '16px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        borderRight: '2px dashed color-mix(in srgb, var(--aacp-accent, #0f766e) 45%, transparent)',
                      }}
                    >
                      <span
                        style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '9px',
                          background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 20%, transparent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: '9px',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 11l3 3L22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </svg>
                      </span>
                      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '8px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>Você economiza</div>
                      <div style={{ fontSize: '19px', fontWeight: 700, color: 'var(--aacp-accent, #0f766e)', letterSpacing: '-.4px', marginTop: '3px', lineHeight: 1 }}>{stateStr(s, 'couponStr')}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '9px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.35 }}>Consegui uma promoção pra você</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: "'Space Mono',monospace",
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '1.5px',
                            color: 'var(--aacp-accent, #0f766e)',
                            border: '1px dashed color-mix(in srgb, var(--aacp-accent, #0f766e) 55%, transparent)',
                            borderRadius: '7px',
                            padding: '4px 9px',
                            background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 8%, transparent)',
                          }}
                        >
                          {stateStr(s, 'couponCode')}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--mut)' }}>aplicado</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--bd)', paddingTop: '9px' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--mut)' }}>Subtotal c/ desconto</span>
                        <span style={{ fontSize: '15px', fontWeight: 700 }}>{stateStr(s, 'totalStr')}</span>
                      </div>
                    </div>
                  </div>
                </ShimmerBorder>
                {stateBool(s, 'showCouponUrgency') && (
                  <div
                    className="coupon-urgency"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '9px',
                      marginTop: '10px',
                      padding: '11px 13px',
                      borderRadius: '12px',
                      background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 8%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--aacp-accent, #0f766e) 22%, transparent)',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Space Mono',monospace",
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--aacp-accent, #0f766e)',
                        flex: 'none',
                        minWidth: '42px',
                      }}
                    >
                      {stateStr(s, 'couponCountdown')}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--tx)', lineHeight: 1.45 }}>
                      Se você finalizar dentro do tempo, ganha mais{' '}
                      <strong style={{ color: 'var(--aacp-accent, #0f766e)' }}>{stateStr(s, 'couponBonusStr')}</strong> ({stateStr(s, 'couponBonusPercent')}% extra).
                    </span>
                  </div>
                )}
              </div>
            )}

            {m.isBundle && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '14px', position: 'relative', overflow: 'hidden' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    fontFamily: "'Space Mono',monospace",
                    fontSize: '8.5px',
                    letterSpacing: '.5px',
                    background: 'var(--g1)',
                    color: '#fff',
                    padding: '3px 9px',
                    borderRadius: '0 0 0 10px',
                  }}
                >
                  COMBO −{stateStr(s, 'recBadgeStr')}
                </div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '8.5px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)', marginBottom: '9px' }}>
                  Costuma ser adicionado junto
                </div>
                <div style={{ display: 'flex', gap: '13px' }}>
                  <div
                    style={{
                      width: '54px',
                      height: '54px',
                      borderRadius: '12px',
                      flex: 'none',
                      background: 'repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)',
                      border: '1px solid var(--bd)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{stateStr(s, 'recTitle')}</div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>{stateStr(s, 'recSubtitle')}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: '10px', color: 'var(--mut)', textDecoration: 'line-through' }}>{stateStr(s, 'recWasStr')}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{stateStr(s, 'recNowStr')}</div>
                  </div>
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isFieldActive && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--mut)' }}>{m.fieldTag}</span>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', color: 'var(--g2)' }}>{fieldProgress}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', border: '1px solid var(--bd)', background: 'var(--chip)', borderRadius: '12px', padding: '9px 9px 9px 13px' }}>
                  <input
                    value={fieldValue}
                    onChange={onFieldInput}
                    onKeyDown={onFieldKey}
                    placeholder={fieldPlaceholderLive}
                    style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--tx)', fontSize: '13.5px', padding: 0 }}
                  />
                  {stateBool(s, 'voiceEnabled') && (
                    <button type="button" onClick={stateFn(s, 'dictateField')} title="Responder por voz" style={stateStyle(s, 'fieldMicStyle')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fieldMicColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="3" width="6" height="11" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                      </svg>
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {stateBool(s, 'canFieldBack') && (
                    <button
                      type="button"
                      onClick={stateFn(s, 'fieldBack')}
                      title="Corrigir o anterior"
                      style={{
                        flex: 'none',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: 'var(--mut)',
                        padding: '10px 14px',
                        borderRadius: '11px',
                        border: '1px solid var(--bd)',
                        background: 'var(--chip)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                      Voltar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={stateFn(s, 'confirmField')}
                    style={{
                      flex: 1,
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      color: '#fff',
                      padding: '10px',
                      borderRadius: '11px',
                      background: 'var(--g1)',
                    }}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isAddress && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '11px' }}>
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
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--g2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Endereço de entrega</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>Encontrado pelo CEP</div>
                  </div>
                </div>
                <div style={{ fontSize: '12.5px', lineHeight: 1.5, color: 'var(--tx)' }}>
                  {stateStr(s, 'addrName')}
                  <br />
                  {stateStr(s, 'addrLine1')}
                  <br />
                  {stateStr(s, 'addrLine2')}
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isShipping && m.options && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {m.options.map((opt) => (
                  <ShimmerBorder key={opt.label} radius="15px">
                  <div onClick={opt.onSelect} style={{ ...opt.cardStyle, border: 'none', background: 'transparent' }} role="button" tabIndex={0}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{opt.label}</span>
                        <span style={opt.tagStyle}>{opt.tag}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>{opt.sub}</div>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, flex: 'none' }}>{opt.price}</div>
                  </div>
                  </ShimmerBorder>
                ))}
              </div>
            )}

            {m.isSummary && m.rows && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '15px' }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)', marginBottom: '11px' }}>
                  Resumo do pedido
                </div>
                {m.rows.map((r) => (
                  <div key={r.label} style={r.rowStyle}>
                    <span style={{ fontSize: '12.5px', color: 'var(--mut)', flex: 1, minWidth: 0, paddingRight: '14px', lineHeight: 1.35 }}>{r.label}</span>
                    <span style={r.valStyle}>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Total final</span>
                  <span style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-.4px' }}>{stateStr(s, 'totalStr')}</span>
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isPayMethods && m.methods && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)' }}>
                  Como você quer pagar?
                </div>
                {m.methods.map((pm) => (
                  <ShimmerBorder key={pm.title} radius="15px">
                  <div onClick={pm.onSelect} style={{ ...pm.cardStyle, border: 'none', background: 'transparent' }} role="button" tabIndex={0}>
                    <span style={pm.iconWrap}>{pm.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{pm.title}</span>
                        <span style={pm.badgeStyle}>{pm.badge}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>{pm.sub}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </div>
                  </ShimmerBorder>
                ))}
              </div>
            )}

            {m.isPixForm && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '84px', height: '84px', borderRadius: '12px', flex: 'none', background: '#fff', padding: '7px', border: '1px solid var(--bd)' }}>
                    {stateStr(s, 'pixQrCode') ? (
                      <img
                        src={stateStr(s, 'pixQrCode')}
                        alt="PIX QR Code"
                        style={{ width: '100%', height: '100%', borderRadius: '3px', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          backgroundImage: 'repeating-linear-gradient(0deg,#111 0 3px,transparent 3px 6px),repeating-linear-gradient(90deg,#111 0 3px,transparent 3px 6px)',
                          backgroundSize: '6px 6px',
                          borderRadius: '3px',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                      {stateStr(s, 'pixStatus') === 'paid' ? 'Pix confirmado!' : 'Pague com Pix'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', lineHeight: 1.45, marginTop: '4px' }}>
                      {stateStr(s, 'pixStatus') === 'paid'
                        ? 'Pagamento recebido. Seu pedido está sendo processado.'
                        : 'Escaneie o QR Code no app do seu banco. Seu pedido é confirmado assim que o pagamento cai.'}
                    </div>
                  </div>
                </div>
                {stateStr(s, 'pixCopyPaste') && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', marginTop: '13px', padding: '10px 12px', borderRadius: '11px', border: '1px solid var(--bd)', background: 'var(--chip)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: "'Space Mono',monospace", fontSize: '10.5px', color: 'var(--mut)', wordBreak: 'break-all', lineHeight: 1.4 }}>
                      {stateStr(s, 'pixCopyPaste')}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(stateStr(s, 'pixCopyPaste')); }}
                      style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--g2)', flex: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0 0', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >
                      Copiar
                    </button>
                  </div>
                )}
                {!stateStr(s, 'pixCopyPaste') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '13px', padding: '10px 12px', borderRadius: '11px', border: '1px solid var(--bd)', background: 'var(--chip)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: "'Space Mono',monospace", fontSize: '10.5px', color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      00020126360014BR.GOV.BCB.PIX0114+55119...PULSE
                    </span>
                    <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--g2)', flex: 'none' }}>Copiar</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '9px' }}>
                  {stateStr(s, 'pixStatus') === 'paid' ? (
                    <>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--aacp-accent, #0f766e)' }} />
                      Pagamento confirmado
                    </>
                  ) : stateStr(s, 'pixStatus') === 'failed' ? (
                    <>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff4c6c' }} />
                      Pagamento falhou — tente outro método
                    </>
                  ) : (
                    <>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dot)', animation: 'pulseDot 2s infinite' }} />
                      {stateStr(s, 'pixStatus') === 'waiting' ? 'Aguardando pagamento…' : 'Aguardando pagamento · expira em 14:58'}
                    </>
                  )}
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isCardForm && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--mut)' }}>Número do cartão</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '11px 13px',
                    borderRadius: '11px',
                    border: '1px solid var(--bd)',
                    background: 'var(--chip)',
                    fontFamily: "'Space Mono',monospace",
                    fontSize: '13px',
                    letterSpacing: '1px',
                  }}
                >
                  4242 4242 4242 4242
                  <svg width="22" height="14" viewBox="0 0 36 24">
                    <rect width="36" height="24" rx="4" fill="#1a1f71" />
                    <circle cx="15" cy="12" r="7" fill="#eb001b" opacity=".9" />
                    <circle cx="21" cy="12" r="7" fill="#f79e1b" opacity=".9" />
                  </svg>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', marginBottom: '6px' }}>Validade</div>
                    <div style={{ padding: '11px 13px', borderRadius: '11px', border: '1px solid var(--bd)', background: 'var(--chip)', fontFamily: "'Space Mono',monospace", fontSize: '13px' }}>
                      06 / 28
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', marginBottom: '6px' }}>CVV</div>
                    <div style={{ padding: '11px 13px', borderRadius: '11px', border: '1px solid var(--bd)', background: 'var(--chip)', fontFamily: "'Space Mono',monospace", fontSize: '13px' }}>
                      •••
                    </div>
                  </div>
                </div>
                {m.showInstallments && m.installments && (
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', margin: '4px 0 7px' }}>Parcelas</div>
                    <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                      {m.installments.map((inst) => (
                        <button key={inst.label} type="button" onClick={inst.onSelect} style={inst.style}>
                          {inst.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '2px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  Criptografado · processado com segurança
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isCryptoForm && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '13px' }}>
                  <span
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '9px',
                      background: 'var(--g1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 'none',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                      <path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.2L12 16.4 5.7 20.8 8 13.6 2 9.2h7.6z" />
                    </svg>
                  </span>
                  <div>
                    <div style={{ fontSize: '13.5px', fontWeight: 700 }}>Pagar com crypto · Stellar</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>Liquidação instantânea + cashback</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', borderRadius: '12px', background: 'var(--card)', border: '1px solid var(--bd)', marginBottom: '9px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: 'var(--aacp-accent, #0f766e)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: "'Space Mono',monospace",
                        fontSize: '9px',
                        fontWeight: 700,
                        color: '#fff',
                        flex: 'none',
                      }}
                    >
                      $
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>USDC</span>
                  </span>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '11px', color: 'var(--mut)' }}>Saldo: 320,00</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--mut)', padding: '2px 2px' }}>
                  <span>Valor a pagar</span>
                  <span style={{ color: 'var(--tx)', fontWeight: 600 }}>≈ {stateStr(s, 'cryptoUsdc')} USDC</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '9px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--g2)' }} />
                  Cashback de {stateStr(s, 'cashbackStr')} em USDC após confirmar
                </div>

                {/* MetaMask CCTP button */}
                <button
                  type="button"
                  disabled={mmStatus === 'connecting' || mmStatus === 'approving' || mmStatus === 'burning'}
                  onClick={() => void payWithMetaMask(cryptoUsdc, merchantStellar)}
                  style={{
                    marginTop: '13px',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '11px 14px',
                    borderRadius: '13px',
                    border: 'none',
                    cursor: mmStatus === 'connecting' || mmStatus === 'approving' || mmStatus === 'burning' ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    color: '#fff',
                    background: mmStatus === 'submitted' ? 'var(--aacp-accent, #0f766e)' : mmStatus === 'error' ? '#ff4c6c' : '#f6851b',
                    opacity: mmStatus === 'connecting' || mmStatus === 'approving' || mmStatus === 'burning' ? 0.72 : 1,
                    transition: 'background .2s, opacity .2s',
                  }}
                >
                  {/* MetaMask fox icon */}
                  <svg width="16" height="16" viewBox="0 0 35 33" fill="none">
                    <path d="M32.9 1L19.4 10.7l2.4-5.8L32.9 1z" fill="#E17726" stroke="#E17726" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2.1 1l13.4 9.8-2.3-5.9L2.1 1z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M28.2 23.5l-3.6 5.5 7.7 2.1 2.2-7.5-6.3-.1zM.6 23.6l2.2 7.5 7.7-2.1-3.6-5.5-6.3.1z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10.1 14.5l-2.1 3.2 7.5.3-.3-8-5.1 4.5zM24.9 14.5l-5.2-4.6-.2 8.1 7.5-.3-2.1-3.2zM10.5 29l4.5-2.2-3.9-3-.6 5.2zM20 26.8l4.5 2.2-.6-5.2-3.9 3z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M24.5 29l-4.5-2.2.4 3-.1 1.1 4.2-1.9zM10.5 29l4.2 1.9-.1-1.1.4-3-4.5 2.2z" fill="#D5BFB2" stroke="#D5BFB2" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14.8 21.8l-3.7-1.1 2.6-1.2 1.1 2.3zM20.2 21.8l1.1-2.3 2.6 1.2-3.7 1.1z" fill="#233447" stroke="#233447" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10.5 29l.6-5.5-4.5.1 3.9 5.4zM23.9 23.5l.6 5.5 3.9-5.4-4.5-.1zM27.4 17.7l-7.5.3.7 3.8 1.1-2.3 2.6 1.2 3.1-2.9v-.1zM11.1 20.7l2.6-1.2 1.1 2.3.7-3.8-7.5-.3 3.1 3z" fill="#CC6228" stroke="#CC6228" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7.5 17.7l3.1 6.1-.1-3.1-3-3zM24.5 20.7l-.1 3.1 3.1-6.1-3 3zM15.2 17.9l-.7 3.8.9 4.6.2-6.1-.4-2.3zM19.8 17.9l-.4 2.3.2 6.1.9-4.6-.7-3.8z" fill="#E27525" stroke="#E27525" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20.2 21.8l-.9 4.6.6.5 3.9-3 .1-3.1-3.7-1zM11.1 20.7l.1 3.1 3.9 3 .6-.5-.9-4.6-3.7-1z" fill="#F5841F" stroke="#F5841F" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20.3 30.9l.1-1.1-.3-.3h-5.2l-.3.3.1 1.1-4.2-1.9 1.5 1.2 3 2h5.1l3-2 1.5-1.2-4.3 1.9z" fill="#C0AC9D" stroke="#C0AC9D" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20 26.8l-.6-.5h-3.8l-.6.5-.4 3 .3-.3h5.2l.3.3-.4-3z" fill="#161616" stroke="#161616" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M33.5 11.3L34.8 5l-1.9-4-12.9 9.6 5 4.2 7 2 1.5-1.8-.7-.5 1.1-1-.8-.6 1.1-.8-.7-.8zM.2 5l1.4 6.3-.9.8 1.1.8-.8.6 1.1 1-.7.5 1.5 1.8 7-2 5-4.2L2.1 1 .2 5z" fill="#763E1A" stroke="#763E1A" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M32.2 15.6l-7-2 2.1 3.2-3.1 6.1 4.1-.1h6.3l-2.4-7.2zM9.8 13.6l-7 2-2.4 7.2h6.3l4.1.1-3.1-6.1 2.1-3.2zM19.8 17.9l.4-8.1 2.4-5.8H12.4l2.4 5.8.4 8.1.1 2.3v6.1h3.8l.1-6.1.6-2.3z" fill="#F5841F" stroke="#F5841F" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {METAMASK_STATUS_LABEL[mmStatus]}
                </button>

                {/* Submitted: show tx hash */}
                {mmStatus === 'submitted' && mmTxHash && (
                  <div style={{ marginTop: '8px', padding: '9px 11px', borderRadius: '10px', background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--aacp-accent, #0f766e) 25%, transparent)' }}>
                    <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--g2)', marginBottom: '3px' }}>
                      TX · Base
                    </div>
                    <a
                      href={safeExternalUrl(`https://basescan.org/tx/${encodeURIComponent(mmTxHash)}`) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "'Space Mono',monospace", fontSize: '9.5px', color: 'var(--g2)', wordBreak: 'break-all', textDecoration: 'none' }}
                    >
                      {mmTxHash.slice(0, 18)}…{mmTxHash.slice(-6)}
                    </a>
                  </div>
                )}

                {/* Error state */}
                {mmStatus === 'error' && mmError && (
                  <div style={{ marginTop: '8px', padding: '9px 11px', borderRadius: '10px', background: 'rgba(255,76,108,.1)', border: '1px solid rgba(255,76,108,.25)', fontSize: '11.5px', color: '#ff4c6c', lineHeight: 1.45 }}>
                    {mmError}
                  </div>
                )}
              </div>
              </ShimmerBorder>
            )}

            {m.isSettlement && m.steps && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: '9.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)' }}>
                    Liquidação na Stellar
                  </span>
                  <span style={m.statusStyle}>{m.statusText}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {m.steps.map((step, si) => (
                    <div key={si} style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                        {step.isDone && (
                          <span
                            style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: 'var(--g1)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </span>
                        )}
                        {step.isActive && (
                          <span
                            style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              border: '2px solid var(--g2)',
                              borderTopColor: 'transparent',
                              animation: 'ringSpin .8s linear infinite',
                            }}
                          />
                        )}
                        {step.isPending && <span style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--bd)' }} />}
                        {step.showLine && <span style={step.lineStyle} />}
                      </div>
                      <div style={{ paddingBottom: '14px', flex: 1 }}>
                        <div style={step.labelStyle}>{step.label}</div>
                        {step.showStatus && (
                          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9.5px', color: 'var(--g2)', marginTop: '2px' }}>{step.status}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </ShimmerBorder>
            )}

            {m.isComplete && (
              <ShimmerBorder radius="18px">
              <div style={{ padding: '18px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '13px' }}>
                  <PulseAgentOrb placement="orderComplete" />
                </div>
                <div style={{ fontSize: '17px', fontWeight: 700 }}>Pedido confirmado</div>
                <div style={{ fontSize: '12px', color: 'var(--mut)', marginTop: '4px' }}>{m.subline}</div>
                {m.lines && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '15px', textAlign: 'left', border: '1px solid var(--bd)', borderRadius: '13px', overflow: 'hidden' }}>
                    {m.lines.map((ln) => (
                      <div key={ln.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '11px 13px', background: 'var(--chip)' }}>
                        <span style={{ fontSize: '12px', color: 'var(--mut)', flex: 'none' }}>{ln.label}</span>
                        <span style={ln.valStyle}>{ln.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {m.isCrypto && (
                  <div style={{ marginTop: '12px', padding: '13px', borderRadius: '13px', background: 'color-mix(in srgb, var(--aacp-accent, #0f766e) 16%, transparent)', border: '1px solid var(--g1)' }}>
                    <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--g2)' }}>Cashback liberado</div>
                    <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '3px' }}>
                      {m.cashbackUsdc} <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--mut)' }}>USDC</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>Disponível na sua próxima compra pela Pulse.</div>
                  </div>
                )}
              </div>
              </ShimmerBorder>
            )}
          </div>
        </div>
      ))}

      {stateBool(s, 'typing') && (
        <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-end', marginTop: '14px' }}>
          <AgentAvatar active />
          <div style={{ display: 'flex', gap: '4px', padding: '12px 14px', borderRadius: '16px 16px 16px 4px', background: 'var(--card)', border: '1px solid var(--bd)' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s infinite' }} />
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s .2s infinite' }} />
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--mut)', animation: 'blink 1.2s .4s infinite' }} />
          </div>
        </div>
      )}

      {stateBool(s, 'hasActions') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px', paddingLeft: '35px' }}>
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={a.fn} style={a.style}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
