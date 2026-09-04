# ADR-005 — Support WebSocket gateway enforces tenant binding

**Status:** PROPOSED (P0 — BLOCKER)
**Module:** `support`
**Issue:** P0-005
**Date:** 2026-09-04

---

## Context

`apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts` (lines 30-44) accepts `join_merchant({merchantId})` and `join_ticket({ticketId})` events. The `merchantId` and `ticketId` come from the client payload — no verification against the socket's authenticated principal.

Any connected client can listen to any tenant's support ticket. Confirmed by reading the gateway code.

---

## Decision

WebSocket handshake authenticates with JWT (merchant) OR embed token (buyer). The server tracks `socket.data.principal = { kind: 'human' | 'embed', tenantId, userId, ... }`. Room joins reject if `requested.merchantId !== principal.tenantId` (humans) or `ticketId` not in principal's tenant scope.

Server emits via `to(merchantRoom)` keyed by authenticated `tenantId` — never trusts client-supplied ids.

---

## Implementation Steps

### 1. Handshake auth

**File:** `apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts`

```typescript
@WebSocketGateway({ namespace: '/support' })
export class SupportGateway implements OnGatewayConnection {
  async handleConnection(client: Socket, ...args: any[]) {
    // Parse token from handshake.auth or Authorization header
    const token = client.handshake.auth?.token ?? client.handshake.headers.authorization?.replace('Bearer ', '');
    try {
      const principal = await this.authService.verifySocketToken(token);
      client.data.principal = principal;
    } catch (err) {
      client.disconnect(true);
    }
  }
}
```

### 2. Replace client-supplied join with server-derived

```typescript
// Before
@SubscribeMessage('join_merchant')
onJoinMerchant(client: Socket, payload: { merchantId: string }) {
  client.join(`merchant:${payload.merchantId}`);  // UNSAFE
}

// After
@SubscribeMessage('join_merchant')
onJoinMerchant(client: Socket, _payload: unknown) {
  const principal = client.data.principal;
  if (!principal) return client.disconnect(true);
  client.join(`merchant:${principal.tenantId}`);
}
```

Same for `join_ticket` — server resolves `ticket.merchantId` from the ticket repo; if `ticket.merchantId !== principal.tenantId` → reject.

### 3. Server-side emit

```typescript
// Emit from use-case via OutboxDispatcher or direct gateway call
emitTicketUpdate(merchantId: string, ticketId: string, payload: any) {
  this.server.to(`merchant:${merchantId}`).emit('ticket_updated', { ticketId, payload });
}
```

The caller (use-case) already has `merchantId` from JWT-derived input. No client round-trip needed.

### 4. Drop `join_ticket` entirely (server emits per-room)

Buyers don't pick rooms; the server joins them based on their `ticketId` at socket connect. Simplest model.

---

## Verification

```bash
# 1. unit — disconnect on missing token
pnpm --filter @zyon/api test support -- --testPathPattern gateway-auth

# 2. e2e — buyer A cannot join ticket of merchant B
cd apps/widget && pnpm e2e:realapi -- --grep support-ws
```

---

## Files Touched

- `apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts` (auth + room binding)
- `apps/api/src/modules/support/application/services/support-gateway-emitter.service.ts` (new — server-side emit)
- `apps/api/src/modules/support/support.module.ts` (wire)
- Widget / dashboard WS client code (pass token in handshake)
- Tests
