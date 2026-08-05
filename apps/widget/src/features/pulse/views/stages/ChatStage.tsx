import type { SearchResultItem, StageProps } from '../types';
import { stateBool, stateFn, stateStr, stateStyle, type InputHandler, type KeyHandler } from '../types';
import { ChatMessages } from '../chat/ChatMessages';
import { SmartCartSheet } from '../chat/SmartCartSheet';
import { PulseAgentOrb } from '../components/PulseAgentOrb';

export function ChatStage({ s }: StageProps) {
  const searchResults = s.searchResults as SearchResultItem[];
  const storeName = stateStr(s, 'storeName');
  const searchQuery = stateStr(s, 'searchQuery');
  const searchPlaceholder = stateStr(s, 'searchPlaceholder');
  const micIconColor = stateStr(s, 'micIconColor');
  const onSearchInput = s.onSearchInput as InputHandler;
  const onSearchKey = s.onSearchKey as KeyHandler;

  return (
    <>
      {stateBool(s, 'chatLoading') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <PulseAgentOrb placement="chatLoading" />
          <div style={{ fontSize: '12.5px', color: 'var(--mut)' }}>Carregando seu carrinho…</div>
        </div>
      )}

      {stateBool(s, 'chatEmpty') && (
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '34px 24px 24px', textAlign: 'center' }}>
          <div style={{ maxWidth: '480px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ marginBottom: '20px' }}>
            <PulseAgentOrb placement="cartEmpty" />
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>Seu carrinho está vazio</div>
          <div style={{ fontSize: '13px', color: 'var(--mut)', lineHeight: 1.5, maxWidth: '280px', marginTop: '6px' }}>
            Sem problema, me diz o que você procura que eu acho as melhores opções da {storeName} pra você.
          </div>

          <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '9px', background: 'var(--card)', border: '1px solid var(--bd)', borderRadius: '14px', padding: '9px 9px 9px 15px', marginTop: '22px' }}>
            <input
              value={searchQuery}
              onChange={onSearchInput}
              onKeyDown={onSearchKey}
              placeholder={searchPlaceholder}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--tx)', fontSize: '13px', padding: 0 }}
            />
            {stateBool(s, 'voiceEnabled') && (
              <button type="button" onClick={stateFn(s, 'dictateSearch')} title="Falar para buscar" style={stateStyle(s, 'micBtnStyle')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={micIconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={stateFn(s, 'onSearch')}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
          </div>

          {stateBool(s, 'searching') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: 'var(--mut)', fontSize: '12px', marginTop: '18px' }}>
              <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--g2)', borderTopColor: 'transparent', animation: 'ringSpin .8s linear infinite' }} />
              Procurando no catálogo da {storeName}…
            </div>
          )}

          {stateBool(s, 'hasResults') && (
            <div style={{ width: '100%', marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '9px', textAlign: 'left' }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--mut)' }}>
                Itens compatíveis
              </div>
              {searchResults.map((r) => (
                <div key={r.title} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px', borderRadius: '14px', background: 'var(--card)', border: '1px solid var(--bd)' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '11px',
                      flex: 'none',
                      background: 'repeating-linear-gradient(135deg,var(--tile1),var(--tile1) 6px,var(--tile2) 6px,var(--tile2) 12px)',
                      border: '1px solid var(--bd)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{r.title}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>{r.subtitle}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>{r.priceStr}</span>
                    <button
                      type="button"
                      onClick={r.onAdd}
                      style={{
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#fff',
                        padding: '6px 12px',
                        borderRadius: '9px',
                        background: 'var(--g1)',
                      }}
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      )}

      {stateBool(s, 'chatFlow') && (
        <>
          <ChatMessages s={s} />
          <SmartCartSheet s={s} />
        </>
      )}
    </>
  );
}
