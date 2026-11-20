/** Provider responses are translated to safe codes; secrets and raw bodies never enter logs or DTOs. */
export class ErpProviderError extends Error {
  constructor(code: string, readonly requiresReconnect = false, readonly retryAfterMs?: number) {
    super(code);
    this.name = "ErpProviderError";
  }
}
