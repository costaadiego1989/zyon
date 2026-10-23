/** Lazy callbacks keep application imports after environment and instrumentation. */
export async function startInstrumentedApplication(steps: {
  loadEnvironment(): void | Promise<void>; initTracing(): Promise<unknown>;
  loadApplication(): Promise<unknown>; shutdownTracing(): Promise<void>;
}): Promise<void> {
  try { await steps.loadEnvironment(); await steps.initTracing(); await steps.loadApplication(); }
  catch (error) { try { await steps.shutdownTracing(); } catch { /* Preserve application exception identity. */ } throw error; }
}

