import type { StageProps } from '../types';
import { stateFn, stateRef, stateStr } from '../types';

export function VoiceOverlay({ s }: StageProps) {
  const waveRef = stateRef<HTMLDivElement>(s, 'waveRef');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '34px 30px',
        textAlign: 'center',
        background: 'rgba(8,8,12,.88)',
        backdropFilter: 'blur(14px)',
        animation: 'overlayIn .25s ease both',
      }}
    >
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', color: '#9aa3b5', marginBottom: '6px' }}>
        {stateStr(s, 'voiceTag')}
      </div>
      <div style={{ fontSize: '13px', color: '#cfcfe0', marginBottom: '32px' }}>{stateStr(s, 'voiceStatusText')}</div>

      <div style={{ position: 'relative', width: '152px', height: '152px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '30px' }}>
        <div style={{ position: 'absolute', inset: '-12px', borderRadius: '50%', border: '1px solid rgba(45,212,255,.4)', animation: 'waveRing 2.2s ease-out infinite' }} />
        <div style={{ position: 'absolute', inset: '-12px', borderRadius: '50%', border: '1px solid rgba(255,92,200,.4)', animation: 'waveRing 2.2s ease-out .7s infinite' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--aacp-accent, #1ED760)', filter: 'blur(9px)', opacity: 0.5 }} />
        <div
          ref={waveRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            height: '62px',
            transform: 'scaleY(var(--amp,.45))',
            transformOrigin: 'center',
            transition: 'transform .08s linear',
          }}
        >
          <span style={{ width: '5px', height: '58px', borderRadius: '4px', background: 'var(--aacp-accent, #1ED760)', animation: 'waveBar .9s ease-in-out infinite' }} />
          <span style={{ width: '5px', height: '58px', borderRadius: '4px', background: 'var(--aacp-accent, #1ED760)', animation: 'waveBar .9s ease-in-out .15s infinite' }} />
          <span style={{ width: '5px', height: '58px', borderRadius: '4px', background: 'var(--aacp-accent, #1ED760)', animation: 'waveBar .9s ease-in-out .3s infinite' }} />
          <span style={{ width: '5px', height: '58px', borderRadius: '4px', background: 'var(--aacp-accent, #1ED760)', animation: 'waveBar .9s ease-in-out .45s infinite' }} />
          <span style={{ width: '5px', height: '58px', borderRadius: '4px', background: 'var(--aacp-accent, #1ED760)', animation: 'waveBar .9s ease-in-out .6s infinite' }} />
        </div>
      </div>

      <div style={{ minHeight: '56px', maxWidth: '300px', fontSize: '18px', fontWeight: 600, lineHeight: 1.4, color: '#fff' }}>
        {stateStr(s, 'voiceTranscript')}
      </div>

      <button
        type="button"
        onClick={stateFn(s, 'stopVoice')}
        style={{
          marginTop: '28px',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          cursor: 'pointer',
          background: 'rgba(255,255,255,.1)',
          border: '1px solid rgba(255,255,255,.22)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
