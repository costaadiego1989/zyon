# ADR-0033: Store Builder Conversational Frontend (Next.js) & Component Contract

**Status:** Proposed  
**Date:** 2026-08-14  
**Author:** Diego  
**Context:** Current widget is React + Vite for embedded checkout. Store Builder frontend is full storefront (NOT embed) accessed via custom domain. New architecture needed: server components, streaming, WebSocket, dynamic theme injection per merchant.

## Decision

**Next.js 15+ App Router** (React 19). No separate storefront SPA.

### Architecture
- **Server Components** for layout, data fetching, tenant detection (custom domain → merchant lookup)
- **Client Components** for chat, real-time updates, theme rendering
- **WebSocket** for live conversation (vs polling)
- **App Router**: `/store/[merchantSlug]` for dynamic routing
- **Streaming**: chat messages progressively rendered (reduced TTFB)

### Component Contract (from conversation-engine → UI)

Every chat message contains structured `blocks`:

```typescript
type ChatMessage = {
  id: string
  role: 'agent' | 'customer'
  text: string
  timestamp: Date
  blocks: Block[]  // ← Rendered in UI
}

type Block = 
  | AgentMessageBlock
  | ProductCardBlock
  | ProductCarouselBlock
  | ProductComparisonBlock
  | VariantSelectorBlock
  | MediaGalleryBlock
  | PriceBreakdownBlock
  | PromotionOfferBlock
  | CartSummaryBlock
  | ShippingOptionsBlock
  | QuickRepliesBlock
  | CheckoutConfirmationBlock
  | PaymentComponentBlock
  | OrderConfirmationBlock
  | OrderTrackingBlock
  | ErrorRecoveryBlock
```

Each block has **merchant-specific design tokens** injected at runtime (colors, fonts, spacing from store theme).

### Theme Injection
- **Design tokens stored in DB** (Store plan merchant → MerchantTheme model)
- **CSS variables injected in Next.js layout** (`--color-primary`, `--font-family`, etc.)
- **Component library** (internal UI kit) respects tokens
- **No hardcoded colors** in components

### Real-time Handshake
- User loads `/store/[slug]`
- Next.js looks up merchant by domain (or slug)
- Creates/resumes `ConversationSession`
- Opens WebSocket to `/ws/conversations/{conversationId}`
- UI subscribes to conversation events
- On message from agent, receives block structure → renders

### Accessibility & Performance
- **WCAG 2.2 AA** (form labels, alt text, keyboard navigation, screen reader tested)
- **Mobile-first** (touch targets ≥44px)
- **Lazy loading** for media blocks
- **Service Worker** for offline fallback + sync
- **Preload merchant theme** in head (CSS custom properties)

## Consequences

- Replaces current React Vite widget frontend with Next.js
- Current widget (embed SDK) stays intact for checkout product
- Store storefront NOT an embed — requires custom domain or Zyon subdomain
- Streaming reduces TTFB but requires Node.js server (no static export)

## Rollout

Phase 3 (Storefront conversational).
