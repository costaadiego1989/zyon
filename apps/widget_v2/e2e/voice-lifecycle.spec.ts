import { expect, test } from '@playwright/test';

for (const pending of ['microphone', 'session'] as const) {
  for (const cancellation of ['pause', 'unmount'] as const) {
    test(`cancel voice on ${cancellation} while ${pending} is pending`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async (pending) => {
        const { React, createRoot, useRealtimeVoiceCheckout } = await import('/e2e/voice-lifecycle-harness.ts');
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const state = { peers: 0, peersClosed: 0, remoteAnswers: 0, sessionRequested: false, tracksStopped: 0, requested: false };
        const stream = { getTracks: () => [{ stop: () => { state.tracksStopped += 1; } }] };
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async () => {
            state.requested = true;
            if (pending === 'microphone') await gate;
            return stream;
          },
        });
        Object.defineProperty(window, 'RTCPeerConnection', {
          configurable: true,
          value: class extends EventTarget {
            iceGatheringState = 'complete';
            connectionState = 'connected';
            localDescription = { sdp: 'v=0\r\n' };
            constructor() {
              super();
              state.peers += 1;
            }
            addTrack() {}
            createDataChannel() {
              return Object.assign(new EventTarget(), { readyState: 'connecting', close() {}, send() {} });
            }
            async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
            async setLocalDescription() {}
            async setRemoteDescription() { state.remoteAnswers++; }
            close() { state.peersClosed++; }
          },
        });
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const probe = { state, release, unmount: () => root.unmount(), voice: null as any };
        (window as any).__voiceLifecycle = probe;
        function Probe() {
          const voice = useRealtimeVoiceCheckout({
            enabled: true,
            createSession: async (sdp: string) => {
              if (!sdp.startsWith('v=0')) throw new Error('Missing offer');
              state.sessionRequested = true;
              if (pending === 'session') await gate;
              return { sdp: 'v=0\r\n' };
            },
            onCommerceTurn: async () => ({ agentMessage: 'OK' }),
            onBeginCheckout: async () => ({ agentMessage: 'OK' }),
          });
          React.useEffect(() => { probe.voice = voice; }, [voice]);
          return null;
        }
        root.render(React.createElement(Probe));
      }, pending);
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__voiceLifecycle.voice))).toBe(true);
      await page.evaluate(() => (window as any).__voiceLifecycle.voice.start());
      await expect.poll(() => page.evaluate(() => (window as any).__voiceLifecycle.state.requested)).toBe(true);
      if (pending === 'session') await expect.poll(() => page.evaluate(() => (window as any).__voiceLifecycle.state.sessionRequested)).toBe(true);
      await page.evaluate(async cancellation => {
        const probe = (window as any).__voiceLifecycle;
        if (cancellation === 'unmount') probe.unmount();
        else probe.voice.stop();
        probe.release();
        // Let the cancelled async continuation settle before checking for leaks.
        await new Promise(resolve => setTimeout(resolve, 50));
      }, cancellation);
      expect(await page.evaluate(() => (window as any).__voiceLifecycle.state)).toEqual({
        peers: pending === 'session' ? 1 : 0,
        peersClosed: pending === 'session' ? 1 : 0,
        remoteAnswers: 0, sessionRequested: pending === 'session', tracksStopped: 1, requested: true,
      });
      await expect(page.locator('audio[data-zyon-realtime-audio]')).toHaveCount(0);
    });
  }
}
