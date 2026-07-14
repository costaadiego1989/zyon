# REFACTOR.md — buyer-account module

## Current State

**Responsibility:** Buyer authentication (registration, login, phone OTP), profile management, M2M agent integration.

**Structure:**
- `domain/entities/buyer-account.entity.ts` — Immutable value object; validates email & display name on construction.
- `domain/services/buyer-jwt.service.ts` — Sign/verify HMAC-based JWTs (B1: separate BUYER_JWT_SECRET).
- `domain/services/m2m-token.service.ts` — Generate SHA256-hashed M2M tokens.
- `domain/ports/otp-store.port.ts` — OTP persistence contract (B3: @Optional in-memory or Prisma).
- `application/use-cases/` — Register, Login, LoginFromSession, GetProfile, UpdateProfile, ChangePassword, PhoneSend, PhoneVerify, M2M agent operations.
- `presentation/http/buyer-account.controller.ts` — Endpoints for registration, login, profile, OTP.
- `infrastructure/` — Repositories + OTP store (in-memory only; TODO: Prisma).

**Key Flows:**
1. Registration → RegisterBuyerUseCase → hash password → BuyerAccount creation → save → JWT issued.
2. Login → LoginBuyerUseCase → fetch account → verify password → JWT issued.
3. Phone OTP → SendBuyerPhoneCodeUseCase → generate code → hash → store (OTP_STORE) → (TODO: send SMS).
4. Phone verification → VerifyBuyerPhoneCodeUseCase → fetch active OTP → compare hash → mark consumed → create phone-only account if needed → JWT issued.

**Known Issues:**
- OTP store is InMemoryOtpStore (P1 TODO: swap to PrismaOtpStore). Production data loss on restart.
- B1: BUYER_JWT_SECRET is separate from JWT_SECRET (good). But mechanism for rotating buyer secrets is missing.
- B6: Phone-only accounts use sentinel passwordHash = "phone_only_no_password". Implicit domain knowledge; not validated.
- OTP verified but never actually sent (SMS/WhatsApp provider not wired; logged to console only).
- GetBuyerPurchasesUseCase returns complex serialized purchase items (purchaseItems function has 40+ lines). Mismatch between domain & presentation shape.
- No rate limit on registration or login attempts.
- Phone number stored as digits-only (no country code). If buyer changes country, ambiguous.

---

## CRITICAL Issues

**C1: OTP store is in-memory; all OTPs lost on restart**
- `buyer-account.module.ts:52`: OTP_STORE bound to InMemoryOtpStore. On pod restart, active OTPs are flushed. Buyer locks themselves out if restart happens between send and verify. Fix: implement PrismaOtpStore backed by buyer_phone_otps table; wire it in module.

**C2: Phone-only account uses sentinel passwordHash instead of null**
- `verify-buyer-phone-code.use-case.ts:56`: passwordHash = "phone_only_no_password". If code path ever changes and tries to hash-compare this value (e.g., accidental password login), it will fail silently or throw. Fix: use NULL in schema; explicitly check for NULL in password-based login.

**C3: Phone number stored without country code; ambiguous**
- `send-buyer-phone-code.use-case.ts:18`: Normalizes phone by removing non-digits. "11988776655" could be Brazil (11) or another country. No country field. Fix: add country_code field to BuyerAccount; require it on phone OTP.

**C4: OTP code sent to console; never reaches buyer**
- `send-buyer-phone-code.use-case.ts:25–27`: Code is logged to console (redacted). Buyer receives nothing. Test-only behavior leaked to production. Fix: integrate SMS/WhatsApp provider (TODO comment exists); remove console logging; implement proper delivery.

---

## HIGH Priority

**H1: No rate limit on registration or login**
- BuyerAccountController.register() and .login() have no rate limiting. Attacker can spam registrations or brute-force passwords. Fix: add @Throttle(5, 60) decorator (5 requests per 60 seconds).

**H2: Password hashing is PasswordHasher from auth module**
- `buyer-account.module.ts:2, 48`: PasswordHasher injected but auth module is not imported. Circular dependency risk. If auth module changes, buyer-account breaks. Fix: move PasswordHasher to shared/security; import by buyer-account, auth, and others.

**H3: LoginBuyerFromSessionUseCase requires session + merchant; buyer is implicit**
- `login-buyer-from-session.use-case.ts`: Used when buyer completes checkout (session_id + merchant_id provided). Creates buyer JWT. But if two merchants both have the same buyer_id, JWT will accept calls to both merchants. Fix: include merchant_id in JWT claims (audience); enforce at guard.

**H4: GetBuyerPurchasesUseCase has 40+ line purchaseItems() serializer**
- `buyer-account.controller.ts:186–216`: Serialization logic should be in a dedicated transformer/DTO, not controller. Too many implicit shape conversions. Fix: extract PurchaseItemDTO & PurchaseHistoryTransformer.

---

## MEDIUM Priority

**M1: BuyerAccount validation logic is constructor-embedded**
- `buyer-account.entity.ts:27–35`: Constructor throws if email invalid, displayName empty, passwordHash missing. No structured validation errors. Caller must parse error.message. Fix: use class-validator decorators; use DTO for input validation.

**M2: OTP attempt lockout is 5 attempts; not configurable**
- `send-buyer-phone-code.use-case.ts:35`: maxAttempts = 5 hardcoded. If merchant wants stricter policy (3 attempts), must fork module. Fix: inject config or use merchant rules.

**M3: M2M token service has no expiry or revocation**
- `m2m-token.service.ts:9–12`: generate() returns plain + hash. Token is stored via UpsertBuyerAgentUseCase, but there is no TTL or revocation endpoint. M2M agent can use token forever. Fix: add exp timestamp; implement revoke endpoint.

**M4: GetBuyerSummaryUseCase has fixed currency "BRL"**
- `buyer-account.controller.ts:171`: summary returns currency: "BRL" hardcoded. If buyer shopped in USD, answer is wrong. Fix: return per-order currency or let buyer filter by currency query param.

---

## LOW Priority

**L1: No phone number format validation**
- `send-buyer-phone-code.use-case.ts:18`: Accepts any string; normalizes to digits. Attacker can submit 100-digit string. Fix: validate format (e.g., 8–15 digits) before storing.

**L2: ChangeBuyerPasswordUseCase does not verify old password before accepting new**
- If someone has access to API token, they can change password without knowing current password. Fix: require current_password verification (already in DTO but not validated in use-case).

**L3: UpdateBuyerProfileUseCase allows partial updates but no atomicity**
- `update-buyer-profile.use-case.ts`: If phone & address are both provided, and phone save fails, address is already updated. Fix: use transaction; atomically update all or none.

**L4: GetBuyerPurchasesUseCase returns page with cursor but no total count**
- Pagination response has nextCursor but no total_count or has_more hint for UI. Fix: return total_count (if available) or has_more boolean.

---

## Coupling Map

```
buyer-account module
├─ → auth (PasswordHasher)
├─ → checkout (LoginBuyerFromSessionUseCase calls CheckoutRepository)
├─ → buyer-purchase-history (GetBuyerPurchasesUseCase returns history)
├─ → integrations (TenantWebhookPublisher for M2M changes)
└─ → shared/config (requireSecret for BUYER_JWT_SECRET)

Incoming:
├─ ← widget (buyer registration, login)
├─ ← buyer dashboard (profile, purchases)
└─ ← merchant dashboard (M2M agent config)

Outgoing:
├─ buyer.registered webhook
└─ buyer_agent.enabled/revoked webhook
```

Moderate coupling: depends on auth (shared hash function), checkout (session lookup), buyer-purchase-history (history retrieval). Outgoing webhooks are lightweight.

---

## Proposed Changes

### Phase 1: Implement PrismaOtpStore (C1)

**Create persistent OTP store**
```typescript
// buyer-account/infrastructure/prisma-otp-store.ts
export class PrismaOtpStore implements OtpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: Omit<OtpRecord, 'attempts' | 'consumedAt'>): Promise<void> {
    await this.prisma.buyerPhoneOtp.upsert({
      where: { phone: record.phone },
      create: {
        phone: record.phone,
        codeHash: record.codeHash,
        maxAttempts: record.maxAttempts,
        attempts: 0,
        expiresAt: record.expiresAt,
        consumedAt: null,
      },
      update: {
        codeHash: record.codeHash,
        maxAttempts: record.maxAttempts,
        attempts: 0,
        expiresAt: record.expiresAt,
        consumedAt: null,
      },
    });
  }

  async findActive(phone: string, now = new Date()): Promise<OtpRecord | null> {
    const record = await this.prisma.buyerPhoneOtp.findUnique({ where: { phone } });
    if (!record) return null;
    if (record.expiresAt < now || record.consumedAt) return null;
    return record;
  }

  async incrementAttempts(phone: string): Promise<OtpRecord | null> {
    return this.prisma.buyerPhoneOtp.update({
      where: { phone },
      data: { attempts: { increment: 1 } },
    });
  }

  async consume(phone: string, now = new Date()): Promise<void> {
    await this.prisma.buyerPhoneOtp.update({
      where: { phone },
      data: { consumedAt: now },
    });
  }
}

// buyer-account-repository.module.ts
providers: [
  {
    provide: OTP_STORE,
    useFactory: (prisma: PrismaClient) => new PrismaOtpStore(prisma),
    inject: [PRISMA_CLIENT],
  },
]
```

### Phase 2: Fix phone-only sentinel (C2)

**Use NULL & explicit check**
```typescript
// buyer-account.entity.ts
export interface BuyerAccountProps {
  globalUserId: string;
  email: string;
  passwordHash: string | null; // NULL for phone-only
  displayName: string;
  phone?: string;
  cpf?: string;
  address?: CustomerAddress;
  createdAt: Date;
  updatedAt: Date;
}

export class BuyerAccount {
  constructor(props: BuyerAccountProps) {
    if (props.email && !props.passwordHash && !props.phone) {
      throw new Error("buyer_account_must_have_password_or_phone");
    }
    this.passwordHash = props.passwordHash ?? null;
  }
}

// login-buyer.use-case.ts
async execute(input: {...}): Promise<...> {
  const account = await this.repo.findByEmail(input.email);
  if (!account || account.passwordHash === null) {
    throw new UnauthorizedException("email_or_password_invalid");
  }
  const valid = await this.hasher.verify(input.password, account.passwordHash);
  ...
}
```

### Phase 3: Add country code to phone (C3)

**Normalize with country context**
```typescript
// buyer-account.entity.ts
export interface BuyerAccountProps {
  ...
  phone?: string;
  phoneCountryCode?: string; // e.g., "BR", "US"
}

// send-buyer-phone-code.use-case.ts
async execute(input: SendBuyerPhoneCodeRequest): Promise<...> {
  const normalized = input.phone.replace(/\D/g, "");
  const countryCode = input.countryCode || "BR"; // Default or infer

  if (normalized.length < 8 || normalized.length > 15) {
    throw new BadRequestException("phone_invalid_length");
  }
  const code = String(randomInt(100000, 1000000));
  const codeHash = createHash("sha256").update(code).digest("hex");

  await this.otpStore.save({
    phone: `${countryCode}:${normalized}`,
    codeHash,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  // TODO: integrate SMS/WhatsApp provider
  console.debug(`[OTP] to ${countryCode}:***${normalized.slice(-4)}`);
  return { sent: true, delivered_to: `***${normalized.slice(-4)}` };
}
```

### Phase 4: Integrate SMS provider (C4)

**Add SMS port & adapter**
```typescript
// buyer-account/domain/ports/sms.port.ts
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

// buyer-account/infrastructure/adapters/twilio.sms.ts
export class TwilioSmsSender implements SmsSender {
  constructor(private readonly client: Twilio) {}

  async send(phone: string, message: string): Promise<void> {
    await this.client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone,
    });
  }
}

// send-buyer-phone-code.use-case.ts
constructor(
  @Inject(OTP_STORE) private readonly otpStore: OtpStore,
  @Optional() @Inject(SMS_PROVIDER) private readonly sms?: SmsSender
) {}

async execute(input: {...}): Promise<...> {
  const code = String(randomInt(100000, 1000000));
  ...
  if (this.sms) {
    await this.sms.send(input.phone, `Your code: ${code}`);
  } else {
    console.warn(`[OTP] SMS not configured; code=${code}`);
  }
}
```

### Phase 5: Add rate limiting (H1)

**Throttle endpoints**
```typescript
// buyer-account.controller.ts
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@UseGuards(ThrottlerGuard)
@Controller('buyer')
export class BuyerAccountController {
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async register(...) { ... }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  async login(...) { ... }

  @Post('phone/send')
  @Throttle({ default: { limit: 3, ttl: 60 } })
  async sendCode(...) { ... }
}
```

### Phase 6: Move PasswordHasher to shared (H2)

**Extract shared utility**
```typescript
// shared/security/password-hasher.service.ts
@Injectable()
export class PasswordHasher {
  // Implementation moved here
}

// auth/auth.module.ts & buyer-account/buyer-account.module.ts
providers: [PasswordHasher]
```

### Phase 7: Include merchant_id in buyer JWT (H3)

**Add to claims**
```typescript
// buyer-jwt.service.ts
export interface BuyerJwtPayload {
  sub: string;
  email: string;
  merchantId?: string; // For LoginFromSession
  role: "buyer";
  aud: "buyer";
  iat: number;
  exp: number;
}

// login-buyer-from-session.use-case.ts
const payload: BuyerJwtPayload = {
  ...,
  merchantId: input.merchant_id, // Bind buyer to merchant
};
```

### Phase 8: Extract purchase serializer (H4)

**Create DTO & transformer**
```typescript
// buyer-account/presentation/dtos/purchase-history.dto.ts
export class PurchaseHistoryDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  order_id: string;

  @ApiProperty({ type: [PurchaseItemDTO] })
  items: PurchaseItemDTO[];
}

// buyer-account/presentation/transformers/purchase.transformer.ts
export class PurchaseTransformer {
  static toPurchaseDTO(purchase: PurchaseRecord): PurchaseHistoryDTO {
    return {
      id: purchase.orderId,
      order_id: purchase.orderId,
      items: purchase.items.map((item) => ({
        sku: item.sku,
        name: item.title,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        line_total: item.unitPrice * item.quantity,
      })),
    };
  }
}

// buyer-account.controller.ts
import { PurchaseTransformer } from './transformers/purchase.transformer';

async getPurchaseHistory(...) {
  ...
  return {
    items: page.records.map(PurchaseTransformer.toPurchaseDTO),
    next_cursor: page.nextCursor
  };
}
```

### Phase 9: Add merchant_id validation to JWT (Additional)

**Enforce at guard**
```typescript
// buyer-jwt-auth.guard.ts
canActivate(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest();
  const token = readBearerToken(request);
  const claims = this.jwt.verify(token);
  const merchant = currentTenantPrincipal(request)?.tenantId;
  if (claims.merchantId && merchant && claims.merchantId !== merchant) {
    throw new ForbiddenException('buyer_merchant_mismatch');
  }
  return true;
}
```

---

## SOLID Principles

| Principle | Current | Proposed |
|-----------|---------|----------|
| **SRP** | BuyerAccountController has 10+ endpoints + phone logic. | Extract PhoneAuthController. |
| **OCP** | OtpStore is fixed interface; new storage strategies need new code. | Already uses port/adapter ✓. |
| **LSP** | InMemoryOtpStore & PrismaOtpStore both implement OtpStore. | Ensure contracts are identical. |
| **ISP** | BuyerAccountRepository exports 6 methods; OK. | Consider splitting read/write. |
| **DIP** | BuyerAccountController injects 10 use-cases directly. | Inject a dispatcher or facade. |

---

## Object Calisthenics

| Rule | Current | Proposed |
|------|---------|----------|
| 1: One level of indentation | purchaseItems() has 3–4 levels. | Extract toItemDTO() helper. |
| 2: Don't use `else` | Mostly ternary; OK. | — |
| 3: Wrap primitives | phone: string, displayName: string. | Wrap: `class Phone(phone, countryCode)`, `class DisplayName`. |
| 4: One dot per line | created_at.toISOString() (1 dot). | OK. |
| 5: Don't abbreviate | OK. | — |
| 6: Keep collections small | Not violated. | — |
| 7: No getters/setters | Entities use snapshot(); OK. | ✓ |
| 8: No classes with 2+ responsibilities | BuyerAccountController handles auth + profile + purchases. | Extract PhoneAuthController. |
| 9: No getters for internal state | Not violated. | — |

---

## Summary

**Refactor Strategy:**
1. Implement PrismaOtpStore for persistent OTP storage (C1).
2. Fix phone-only account: use NULL instead of sentinel (C2).
3. Add country code to phone numbers (C3).
4. Integrate SMS provider (SMS port + Twilio adapter) (C4).
5. Add rate limiting to registration + login (H1).
6. Move PasswordHasher to shared/ (H2).
7. Include merchant_id in buyer JWT (H3).
8. Extract purchase serializer to DTO/Transformer (H4).
9. Add password verification before change (L2).
10. Result: persistent OTPs, phone-only accounts robust, SMS delivery working, rate-limited, clear serialization.

**Estimated Effort:** 4–5 days (includes SMS provider integration).
