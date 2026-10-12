import { expect, test } from '@playwright/test';

for (const pending of ['microphone', 'session'] as const) {
  for (const cancellation of ['pause', 'unmount'] as const) {
    test(`cancel voice on ${cancellation} while ${pending} is pending`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async (pending) => {
        const { React, createRoot, useRealtimeVoiceCheckout } = await import('/e2e/voice-lifecycle-harness.ts');
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const state = { peers: 0, tracksStopped: 0, requested: false };
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
          value: class {
            constructor() {
              state.peers += 1;
              throw new Error('A cancelled connection must never create a peer');
            }
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
            createSession: async () => {
              if (pending === 'session') await gate;
              return { value: 'unused-test-secret' };
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
      await page.evaluate(async cancellation => {
        const probe = (window as any).__voiceLifecycle;
        if (cancellation === 'unmount') probe.unmount();
        else probe.voice.stop();
        probe.release();
        // Let the cancelled async continuation settle before checking for leaks.
        await new Promise(resolve => setTimeout(resolve, 50));
      }, cancellation);
      expect(await page.evaluate(() => (window as any).__voiceLifecycle.state)).toEqual({
        peers: 0, tracksStopped: 1, requested: true,
      });
      await expect(page.locator('audio[data-zyon-realtime-audio]')).toHaveCount(0);
    });
  }
}
