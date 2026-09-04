import type { RenderState } from './types';
import { safeExternalUrl } from '../../../lib/safe-url';
import { stateBool, stateFn, stateStr, stateStyle } from './types';
import { LoginStage } from './stages/LoginStage';
import { IntroStage } from './stages/IntroStage';
import { ChatStage } from './stages/ChatStage';
import { HubStage } from './stages/HubStage';
import { lazy, Suspense } from 'react';
const VoiceOverlay = lazy(() => import('./overlays/VoiceOverlay').then(m => ({ default: m.VoiceOverlay })));
import { SupportPanel } from './overlays/SupportPanel';
import { SettingsModal } from './overlays/SettingsModal';

interface PulseWidgetProps {
  s: RenderState;
}

export function PulseWidget({ s }: PulseWidgetProps) {
  const privacyUrl = stateStr(s, 'privacyUrl');
  const voiceToggleColor = stateStr(s, 'voiceToggleColor');
  const widgetStyle = stateStyle(s, 'widgetStyle');
  const merchantLogoUrl = safeExternalUrl(stateStr(s, 'merchantLogoUrl'));

  return (
    <div
      className="pulse-widget-shell"
      data-theme={stateStr(s, 'theme')}
      style={{ ...widgetStyle, boxShadow: 'none', borderRadius: 0, overflow: 'hidden' }}
    >
      {stateBool(s, 'showHeader') && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '12px 14px',
            borderBottom: 'none',
            zIndex: 9,
            background: 'var(--bg)',
            flex: 'none',
          }}
        >
          <button
            type="button"
            onClick={stateFn(s, 'backToStore')}
            title="Voltar para o site"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '1px solid var(--bd)',
              background: 'var(--chip)',
              color: 'var(--mut)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              padding: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '12px',
              border: '1px solid var(--bd)',
              background: 'var(--chip)',
              color: 'var(--tx)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              overflow: 'hidden',
              fontSize: '13px',
              fontWeight: 800,
              letterSpacing: '-.2px',
            }}
          >
            {merchantLogoUrl ? (
              <img src={merchantLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              stateStr(s, 'merchantInitial')
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stateStr(s, 'headerTitle')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dot)', animation: 'pulseDot 2.2s ease-in-out infinite', flex: 'none' }} />
              {stateStr(s, 'headerSub')}
            </div>
          </div>

          {stateBool(s, 'showVoiceToggle') && (
            <button type="button" onClick={stateFn(s, 'toggleVoiceMode')} title={stateStr(s, 'voiceModeTitle')} style={stateStyle(s, 'voiceToggleStyle')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={voiceToggleColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}

          {stateBool(s, 'isChat') && (
            <>
              <button
                type="button"
                onClick={stateFn(s, 'goHub')}
                title="Meus pedidos"
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={stateFn(s, 'toggleTheme')}
            title="Tema"
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
            <svg width="15" height="15" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" fill="none" stroke="var(--mut)" strokeWidth="1.8" />
              <path d="M12 3a9 9 0 0 0 0 18z" fill="var(--mut)" />
            </svg>
          </button>
        </div>
      )}

      <div className="shimmer-border pulse-widget-frame" style={{ ['--shimmer-r' as string]: '28px' }}>
        <div className="shimmer-border__inner pulse-widget-inner" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', boxShadow: 'none' }}>
          {stateBool(s, 'isLogin') && <LoginStage s={s} />}
          {stateBool(s, 'isIntro') && <IntroStage s={s} />}
          {stateBool(s, 'isChat') && <ChatStage s={s} />}
          {stateBool(s, 'isHub') && <HubStage s={s} />}
        </div>
      </div>

      {stateBool(s, 'voiceOpen') && <Suspense fallback={null}><VoiceOverlay s={s} /></Suspense>}

      {stateBool(s, 'fabVisible') && (
        <button type="button" onClick={stateFn(s, 'openSupport')} style={stateStyle(s, 'fabStyle')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18v-6a8 8 0 0 1 16 0v6" />
            <path d="M20 19a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2zM4 19a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2z" />
          </svg>
          <span style={{ position: 'absolute', top: 0, right: 0, width: '13px', height: '13px', borderRadius: '50%', background: 'var(--dot)', border: '2px solid var(--bg)' }} />
        </button>
      )}

      {stateBool(s, 'supportOpen') && <SupportPanel s={s} />}
      {stateBool(s, 'modalOpen') && <SettingsModal s={s} />}
      {stateBool(s, 'showBranding') && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '10px',
            color: 'var(--mut)',
            opacity: 0.7,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
            zIndex: 2,
          }}
        >
          Powered by Zyon
        </div>
      )}
      {privacyUrl && (
        <div
          style={{
            position: 'absolute',
            bottom: stateBool(s, 'showBranding') ? '22px' : '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            fontFamily: 'inherit',
            zIndex: 2,
          }}
        >
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '10.5px',
              color: 'var(--aacp-muted, #64748b)',
              textDecoration: 'none',
            }}
          >
            Política de Privacidade
          </a>
        </div>
      )}
    </div>
  );
}
