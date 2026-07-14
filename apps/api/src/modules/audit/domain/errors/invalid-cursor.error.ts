/**
 * Domain error for invalid cursor format.
 * Application layer throws this; presentation layer maps to HTTP 400.
 * (AUD-M4: Move cursor decode exception to domain error)
 */
export class InvalidCursorError extends Error {
  constructor() {
    super("cursor_invalid");
    this.name = "InvalidCursorError";
  }
}
