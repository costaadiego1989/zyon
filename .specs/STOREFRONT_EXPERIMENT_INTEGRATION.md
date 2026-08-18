# Storefront Experiment Integration — MVVM Pattern

**Completed:** August 18, 2026

## Summary

Implemented transparent A/B experiment integration on Storefront. Buyers see **zero UX change**. The experiment variant (if active) is:
- Assigned at conversation start
- Passed to the agent's system prompt (backend handles this)
- Tracked in analytics for A/B analysis

## Changes

### Backend (NestJS API)

**File:** `apps/api/src/modules/storefront/application/use-cases/start-store-conversation.use-case.ts`

- Enhanced response to include optional `experiment` field with `{ variant_id, variant_name, system_prompt }`
- On conversation start, checks if a running experiment exists
- Uses weighted random assignment to select variant (already built in experiments module)
- Gracefully handles missing Prisma or no active experiment → returns `experiment: null`

**Response shape:**
```typescript
{
  conversation_id: "conv_...",
  merchant_id: "m123",
  created_at: "2026-08-18T...",
  experiment: {
    variant_id: "var_123",
    variant_name: "Test Prompt",
    system_prompt: "You are a helpful sales agent with variant instructions..."
  } | null
}
```

### Frontend (React + Next.js)

#### 1. ViewModel Hook

**File:** `apps/storefront/src/lib/useCheckoutExperiment.ts`

Pure React hook following MVVM pattern:
- Captures experiment from conversation API response
- Exposes: `experiment`, `sessionConversationId`, `captureFromConversationStart()`, `getTrackingVariantId()`
- Persists variantId to `sessionStorage` for analytics
- Immutable after first assignment (single variant per session)

```typescript
const experimentVM = useCheckoutExperiment();

// On conversation start:
experimentVM.captureFromConversationStart(apiResponse);

// Get variant for tracking:
const variantId = experimentVM.getTrackingVariantId(); // "var_123" | null
```

#### 2. Component Integration

**File:** `apps/storefront/src/components/ConversationShell.tsx`

- Import hook: `const experimentVM = useCheckoutExperiment();`
- Capture on conversation init (both paths: eager and lazy)
- Pass `variant_id` when sending messages (backend tracking)
- Update analytics call to include variantId

**Flow:**
```
[User] → selectChannel() 
        → initConversation() calls /storefront/conversations
        → experimentVM.captureFromConversationStart(response)
        → experiment state set (system only, no UI change)
        
[User] → sendMessage()
        → Includes variant_id in request body
        → Backend tracks experiment result
        → Analytics event includes experiment_variant_id
```

#### 3. Analytics

**File:** `apps/storefront/src/lib/analytics.ts`

- `trackConversationStart()` now accepts optional `variantId` parameter
- Attaches `experiment_variant_id` to GA4 event for cohort analysis

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Storefront Experiment Integration — Data Flow                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CONVERSATION START                                          │
│     Buyer clicks "Chat" or "Voice"                             │
│     ↓                                                            │
│     ConversationShell.selectChannel() → initConversation()      │
│     ↓                                                            │
│     POST /storefront/conversations                             │
│     ↓                                                            │
│     API: StartStoreConversationUseCase                          │
│       - Check merchant.experiment (running?)                    │
│       - Weighted random variant selection                       │
│       - Return { conversation_id, experiment: {...} }          │
│     ↓                                                            │
│     experimentVM.captureFromConversationStart(response)        │
│       - Set experiment state (variantId, systemPrompt, name)    │
│       - Persist variantId to sessionStorage                     │
│     ↓                                                            │
│     trackConversationStart(storeName, variantId)               │
│       → GA4 event with experiment_variant_id                   │
│                                                                 │
│  2. MESSAGE SENDING                                             │
│     Buyer types message                                        │
│     ↓                                                            │
│     ConversationShell.sendMessage()                             │
│     ↓                                                            │
│     POST /storefront/conversations/{id}/messages                │
│       {                                                         │
│         user_message: "Hi...",                                 │
│         variant_id: "var_123",    ← Attached by ViewModel      │
│         ...                                                     │
│       }                                                         │
│     ↓                                                            │
│     API: SendStoreMessageUseCase                                │
│       - Agent receives system_prompt from variant              │
│       - Agent responds using variant instructions               │
│       - Track message event with variant_id                    │
│     ↓                                                            │
│     Response: { message, blocks, ... }                         │
│     ↓                                                            │
│     Storefront renders (no variant visible)                     │
│                                                                 │
│  3. ANALYTICS & ATTRIBUTION                                     │
│     sessionStorage has:                                         │
│       - zyon_experiment_variant_id: "var_123"                  │
│       - zyon_experiment_variant_name: "Test Prompt"            │
│     ↓                                                            │
│     Use for post-hoc analysis:                                 │
│       - Cohort messages by variant                              │
│       - Compare purchase rate / revenue / engagement            │
│       - Statistical significance tests                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| ViewModel hook (not context/redux) | Minimal, focused state. No global pollution. Easy to test. |
| Immutable after first assign | Prevents race conditions. Session = one variant always. |
| sessionStorage persistence | Analytics can access variantId even if React state clears. |
| Weighted random on backend | Variants are defined/owned by experiments module. Backend is source of truth. |
| Zero UX changes | Variant is purely internal. Buyer never sees "Test" or "Control" label. |
| Optional Prisma support | Gracefully degrades if experiments module not available. |

## Testing

**Unit Tests:** `apps/api/src/modules/storefront/application/use-cases/start-store-conversation.use-case.spec.ts`
- No experiment running → returns `experiment: null`
- Running experiment → returns variant assignment
- Missing Prisma → gracefully handles (returns `null`)

**Integration Flow:**
1. User selects channel → conversation starts
2. API assigns variant (if experiment running)
3. Storefront captures variantId invisibly
4. Message includes variantId for tracking
5. Analytics tagged with experiment cohort

## Files Changed

| Path | Change | Type |
|------|--------|------|
| `apps/api/src/modules/storefront/application/use-cases/start-store-conversation.use-case.ts` | Add experiment assignment logic | Use-case |
| `apps/storefront/src/lib/useCheckoutExperiment.ts` | **NEW** — ViewModel hook | Hook |
| `apps/storefront/src/components/ConversationShell.tsx` | Integrate hook, capture variant, pass in requests | Component |
| `apps/storefront/src/lib/analytics.ts` | Add variantId parameter to trackConversationStart | Utility |
| `apps/api/src/modules/storefront/application/use-cases/start-store-conversation.use-case.spec.ts` | **NEW** — Unit tests | Test |

## Next Steps (Optional Enhancements)

1. **Track in backend events:** Attach `variant_id` to `checkout_started` outbox event for deeper analytics
2. **Promote winner logic:** Tie winning variant's system_prompt into merchant default rules
3. **A/B UI variants (future):** If team wants to test different UI layouts (not just prompts), extend this pattern to include UI variant data
4. **Real-time dashboard:** Build analytics dashboard querying experiment results by variant
