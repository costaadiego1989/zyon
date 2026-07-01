import type { RenderState } from './types';
import type { AgentOrbPlacement } from '../config/agentOrbPresets';
import { stateBool, stateFn, stateStr, stateStyle } from './types';
import { LoginStage } from './stages/LoginStage';
import { IntroStage } from './stages/IntroStage';
import { ChatStage } from './stages/ChatStage';
import { HubStage } from './stages/HubStage';
import { VoiceOverlay } from './overlays/VoiceOverlay';
import { SupportPanel } from './overlays/SupportPanel';
import { SettingsModal } from './overlays/SettingsModal';
import { PulseAgentOrb } from './components/PulseAgentOrb';

interface PulseWidgetProps {
  s: RenderState;
}

export function PulseWidget({ s }: PulseWidgetProps) {
  const voiceToggleColor = stateStr(s, 'voiceToggleColor');
  const widgetStyle = stateStyle(s, 'widgetStyle');

  return (
    <div
      className="shimmer-border pulse-widget-frame"
      data-theme={stateStr(s, 'theme')}
      style={{ ['--shimmer-r' as string]: '28px' }}
    >
      <div
        className="shimmer-border__inner pulse-widget-inner"
        style={{ ...widgetStyle, boxShadow: 'none' }}
      >
      {stateBool(s, 'showHeader') && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '14px 16px',
            borderBottom: '1px solid var(--bd)',
            zIndex: 9,
            background: 'var(--bg)',
            flex: 'none',
          }}
        >
          {stateBool(s, 'isHub') && (
            <button
              type="button"
              onClick={stateFn(s, 'goChat')}
              title="Voltar"
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
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          <PulseAgentOrb placement={stateStr(s, 'headerOrbPlacement') as AgentOrbPlacement} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, lineHeight: 1.2 }}>{stateStr(s, 'headerTitle')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--mut)', marginTop: '1px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--dot)', animation: 'pulseDot 2.2s ease-in-out infinite' }} />
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
              <button
                type="button"
                onClick={stateFn(s, 'restart')}
                title="Recomeçar"
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
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

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {stateBool(s, 'isLogin') && <LoginStage s={s} />}
        {stateBool(s, 'isIntro') && <IntroStage s={s} />}
        {stateBool(s, 'isChat') && <ChatStage s={s} />}
        {stateBool(s, 'isHub') && <HubStage s={s} />}
      </div>

      {stateBool(s, 'voiceOpen') && <VoiceOverlay s={s} />}

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
    </div>
    </div>
  );
}
