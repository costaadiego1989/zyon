/** A completed rejection proves this request did not create a provider message. */
export class EmailProviderRejection extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) { super(message); this.name = "EmailProviderRejection"; }
}
