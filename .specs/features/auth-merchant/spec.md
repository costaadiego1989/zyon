# Auth and Merchant Module Spec

## Goal

Add first-party merchant authentication with JWT and extract merchant-owned configuration into a dedicated `merchant` module.

## Requirements

- AM-REQ-001: Merchants can register an account with merchant name, email, and password.
- AM-REQ-002: Passwords must be stored as salted hashes, never plaintext.
- AM-REQ-003: Merchants can log in and receive a signed JWT access token.
- AM-REQ-004: JWT payload must include user id, merchant id, email, role, issued-at, and expiration.
- AM-REQ-005: Protected merchant routes must reject missing, malformed, expired, or invalid tokens.
- AM-REQ-006: Merchant module owns merchant profile and merchant rules.
- AM-REQ-007: Merchant reads and writes must be scoped by authenticated `merchant_id`.
- AM-REQ-008: Merchant rules must stay compatible with checkout/decision/shipping DTOs.
- AM-REQ-009: Prisma persistence must include merchants and merchant users.
- AM-REQ-010: Tests must cover auth domain/application, JWT guard behavior, Prisma repositories, and protected merchant e2e flow.

## Acceptance Criteria

- `POST /auth/register` creates a merchant, user, default rules, and returns a JWT.
- `POST /auth/login` validates credentials and returns a JWT.
- `GET /merchants/me` returns the authenticated merchant profile.
- `GET /merchants/me/rules` returns authenticated merchant rules.
- `PUT /merchants/me/rules` updates authenticated merchant rules.
- In-memory tests pass without PostgreSQL.
- Prisma integration/e2e tests pass when Docker Compose PostgreSQL is running.
