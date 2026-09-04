/**
 * Domain errors for the auth module.
 * These are thrown by domain/application layers and mapped to HTTP exceptions by the controller.
 */

export class InvalidCredentialsError extends Error {
  readonly code = "invalid_credentials";
  constructor() {
    super("invalid_credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class EmailAlreadyRegisteredError extends Error {
  readonly code = "email_already_registered";
  constructor(email?: string) {
    super(email ? `email_already_registered:${email}` : "email_already_registered");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class MerchantOwnerNotCreatedError extends Error {
  readonly code = "merchant_owner_not_created";
  constructor(merchantId: string) {
    super(`merchant_owner_not_created:${merchantId}`);
    this.name = "MerchantOwnerNotCreatedError";
  }
}

export class WeakPasswordError extends Error {
  readonly code = "weak_password";
  constructor(reason: string) {
    super(`weak_password:${reason}`);
    this.name = "WeakPasswordError";
  }
}

export class InvalidEmailError extends Error {
  readonly code = "invalid_email";
  constructor(email: string) {
    super(`invalid_email:${email}`);
    this.name = "InvalidEmailError";
  }
}

export class LoginRateLimitedError extends Error {
  readonly code = "login_rate_limited";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("login_rate_limited");
    this.name = "LoginRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class RefreshTokenExpiredError extends Error {
  readonly code = "refresh_failed";
  constructor() {
    super("refresh_failed");
    this.name = "RefreshTokenExpiredError";
  }
}

export class OtpInvalidError extends Error {
  readonly code = "otp_invalid";
  constructor() {
    super("otp_invalid");
    this.name = "OtpInvalidError";
  }
}

export class OtpLockedError extends Error {
  readonly code = "otp_locked";
  constructor() {
    super("otp_locked");
    this.name = "OtpLockedError";
  }
}

export class OtpExpiredError extends Error {
  readonly code = "otp_expired";
  constructor() {
    super("otp_expired");
    this.name = "OtpExpiredError";
  }
}

export class EmailChangeRequestThrottledError extends Error {
  readonly code = "email_change_throttled";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("email_change_throttled");
    this.name = "EmailChangeRequestThrottledError";
    this.retryAfterMs = retryAfterMs;
  }
}
