# Architecture & MVVM Refactor Design

> **Focus**: Decouple components from API calls, establish clean separation of concerns with MVVM pattern

## Current State Issues

### 1. Mixed Concerns (God Components)

**ConversationShell.tsx (913 lines)**
- UI rendering
- API calls (`/storefront/conversations`, `/storefront/cart`)
- State management (messages, cart)
- Event tracking
- Trigger logic
- Theme management
- All in ONE component ❌

**BuyerHub.tsx (884 lines)**
- Profile UI
- Purchase history UI
- OTP/email verification
- Phone verification
- All business logic inline ❌

**SupportPanel.tsx (620 lines)**
- WebSocket connection
- Chat UI
- Message sending
- Token management
- Inline ❌

### 2. Direct API calls in Components

```typescript
// ❌ ANTI-PATTERN: Components call API directly
const res = await fetch(`${API_BASE}/storefront/conversations`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: JSON.stringify(payload),
});
```

Problems:
- Tight coupling to endpoint URLs
- Duplicated error handling
- No testability (can't mock API)
- Scattered API logic across 20+ files
- Hard to migrate endpoints (migration requires editing 20 components)

### 3. State Management Antipatterns

**Cart stored inline in Context** → No separation of concerns
**Triggers logic scattered** → `lib/triggers.ts` + `lib/intervention-tracker.ts` + inline hooks
**Config provider embeds fetch logic** → State and API mixed

---

## Target Architecture: MVVM + Ports & Adapters

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER (React Components)                      │
│  ├─ ConversationShell → ConversationViewModel              │
│  ├─ BuyerHub → BuyerViewModel                              │
│  ├─ SupportPanel → SupportViewModel                        │
│  └─ [UI only — NO direct API calls]                        │
└─────────────────────────────────────────────────────────────┘
              ↑ (useViewModel hook)
              │
┌─────────────────────────────────────────────────────────────┐
│  APPLICATION LAYER (ViewModels)                             │
│  ├─ ConversationViewModel (state + business logic)         │
│  │  ├─ conversationService.startConversation()            │
│  │  ├─ conversationService.sendMessage()                  │
│  │  └─ cartService.updateCart()                           │
│  ├─ BuyerViewModel                                          │
│  ├─ SupportViewModel                                        │
│  └─ [Orchestrate services, handle state transitions]       │
└─────────────────────────────────────────────────────────────┘
              ↑
              │
┌─────────────────────────────────────────────────────────────┐
│  DOMAIN LAYER (Services)                                    │
│  ├─ ConversationService (business logic)                   │
│  │  ├─ conversation repository (port)                      │
│  │  ├─ cart repository (port)                              │
│  │  └─ track event logic                                   │
│  ├─ BuyerService                                            │
│  ├─ SupportService                                          │
│  └─ [Pure logic — NO direct API calls]                     │
└─────────────────────────────────────────────────────────────┘
              ↑
              │ implements
         (depends on)
              │
┌─────────────────────────────────────────────────────────────┐
│  PORTS (Interfaces)                                         │
│  ├─ ConversationRepository (contract)                       │
│  ├─ CartRepository (contract)                               │
│  ├─ BuyerRepository (contract)                              │
│  └─ [Define what services need from external world]        │
└─────────────────────────────────────────────────────────────┘
              ↑ implements
              │
┌─────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE (Adapters)                                  │
│  ├─ ApiConversationRepository (REST API v1)               │
│  ├─ ApiCartRepository (REST API v1)                        │
│  ├─ ApiBuyerRepository (REST API internal)                │
│  └─ [Transform API responses → domain models]              │
└─────────────────────────────────────────────────────────────┘
              ↑
              │
        ┌─────┴─────────────┐
        │                   │
    Internal Routes     Public API v1
   (deprecated)        (current)
```

---

## Folder Structure Refactor

### Before (scattered)

```
src/
├── components/
│   ├── ConversationShell.tsx        (913 lines, mixed)
│   ├── BuyerHub.tsx                 (884 lines, mixed)
│   ├── SupportPanel.tsx             (620 lines, mixed)
│   └── [20+ other UI components]
└── lib/
    ├── cart-store.tsx               (context with inline fetch)
    ├── widget-config.ts             (config provider with fetch)
    ├── hooks/
    │   └── useMarketplaceSearch.ts   (hook with inline fetch)
    └── [analytics, triggers, etc]
```

### After (clean separation)

```
src/
├── app/
│   ├── api/
│   │   ├── proxy/
│   │   │   └── route.ts             (API gateway — v1 endpoints)
│   │   └── checkout-token/route.ts
│   └── store/
│       └── [slug]/page.tsx
│
├── presentation/                    [NEW LAYER]
│   ├── components/
│   │   ├── ConversationShell.tsx     (UI ONLY — NO logic)
│   │   ├── BuyerHub.tsx
│   │   ├── SupportPanel.tsx
│   │   └── [pure UI]
│   └── hooks/
│       ├── useConversationViewModel.ts
│       ├── useBuyerViewModel.ts
│       └── useSupportViewModel.ts
│
├── application/                     [NEW LAYER]
│   ├── viewmodels/
│   │   ├── ConversationViewModel.ts  (state + orchestration)
│   │   ├── BuyerViewModel.ts
│   │   └── SupportViewModel.ts
│   ├── services/
│   │   ├── ConversationService.ts    (business logic)
│   │   ├── BuyerService.ts
│   │   ├── CartService.ts
│   │   ├── SupportService.ts
│   │   └── CatalogService.ts
│   └── mappers/
│       ├── ConversationMapper.ts
│       ├── CartMapper.ts
│       └── [DTO → domain model]
│
├── domain/                          [EXISTING LAYER]
│   ├── ports/
│   │   ├── ConversationRepository.ts (interface)
│   │   ├── CartRepository.ts
│   │   ├── BuyerRepository.ts
│   │   ├── CatalogRepository.ts
│   │   └── SupportRepository.ts
│   ├── models/
│   │   ├── Conversation.ts
│   │   ├── Cart.ts
│   │   ├── Message.ts
│   │   └── [pure domain models]
│   └── types/
│       └── [shared types]
│
├── infrastructure/                  [NEW LAYER]
│   ├── api/
│   │   ├── client.ts                (HTTP client)
│   │   └── config.ts                (base URLs, auth)
│   ├── repositories/
│   │   ├── ApiConversationRepository.ts   (implements ConversationRepository)
│   │   ├── ApiCartRepository.ts           (implements CartRepository)
│   │   ├── ApiBuyerRepository.ts          (implements BuyerRepository)
│   │   ├── ApiCatalogRepository.ts        (implements CatalogRepository)
│   │   └── ApiSupportRepository.ts        (implements SupportRepository)
│   └── mappers/
│       ├── ConversationApiMapper.ts       (API response → domain)
│       ├── CartApiMapper.ts
│       └── [response transformers]
│
├── lib/
│   ├── analytics.ts                 (event tracking — NO API calls)
│   ├── types.ts                     (DTO types only)
│   ├── storage.ts                   (localStorage/sessionStorage)
│   └── [utilities, constants]
│
└── styles/
    └── [CSS modules, theme]
```

---

## MVVM Pattern: Detailed

### 1. ViewModel = State + Orchestration

```typescript
// src/application/viewmodels/ConversationViewModel.ts
import type { ConversationRepository } from "@/domain/ports/ConversationRepository";
import type { CartRepository } from "@/domain/ports/CartRepository";
import { ConversationService } from "../services/ConversationService";
import { CartService } from "../services/CartService";

export interface ConversationViewModelState {
  messages: Message[];
  currentMessage: string;
  isLoading: boolean;
  error: string | null;
  cart: Cart | null;
  conversationId: string | null;
}

export class ConversationViewModel {
  state: ConversationViewModelState = {
    messages: [],
    currentMessage: "",
    isLoading: false,
    error: null,
    cart: null,
    conversationId: null,
  };

  listeners: Set<() => void> = new Set();

  constructor(
    private conversationRepo: ConversationRepository,
    private cartRepo: CartRepository,
  ) {}

  async startConversation(merchantId: string, customerId: string) {
    this.state.isLoading = true;
    this.notify();

    try {
      const service = new ConversationService(this.conversationRepo);
      const result = await service.start({ merchantId, customerId });

      this.state.conversationId = result.id;
      this.state.messages = result.messages;
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to start";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }

  async sendMessage(text: string) {
    if (!this.state.conversationId) return;

    this.state.isLoading = true;
    this.notify();

    try {
      const service = new ConversationService(this.conversationRepo);
      const message = await service.sendMessage({
        conversationId: this.state.conversationId,
        text,
      });

      this.state.messages.push(message);
      this.state.currentMessage = "";
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to send";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }

  async updateCartItem(variantId: string, quantity: number) {
    if (!this.state.conversationId || !this.state.cart) return;

    try {
      const service = new CartService(this.cartRepo);
      const updated = await service.updateItem({
        cartId: this.state.cart.id,
        variantId,
        quantity,
      });

      this.state.cart = updated;
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to update cart";
    }

    this.notify();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l());
  }
}
```

### 2. Service = Business Logic (NO API calls)

```typescript
// src/application/services/ConversationService.ts
import type { ConversationRepository } from "@/domain/ports/ConversationRepository";
import type { Message, Conversation } from "@/domain/models";

export class ConversationService {
  constructor(private repo: ConversationRepository) {}

  async start(input: { merchantId: string; customerId: string }): Promise<Conversation> {
    // Validate input
    if (!input.merchantId || !input.customerId) {
      throw new Error("Invalid merchant or customer ID");
    }

    // Call repository (abstracted — could be v1 API, internal, mock, whatever)
    const conversation = await this.repo.create({
      merchantId: input.merchantId,
      customerId: input.customerId,
    });

    // Business logic: validate response, set defaults, etc.
    if (!conversation.id) {
      throw new Error("Server did not return conversation ID");
    }

    return conversation;
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
  }): Promise<Message> {
    if (!input.text || input.text.trim().length === 0) {
      throw new Error("Message cannot be empty");
    }

    // Call repository
    const message = await this.repo.sendMessage({
      conversationId: input.conversationId,
      text: input.text,
    });

    return message;
  }
}
```

### 3. Port (Interface) = Contract

```typescript
// src/domain/ports/ConversationRepository.ts
import type { Conversation, Message } from "@/domain/models";

export interface ConversationRepository {
  create(input: { merchantId: string; customerId: string }): Promise<Conversation>;
  sendMessage(input: { conversationId: string; text: string }): Promise<Message>;
  getHistory(conversationId: string): Promise<Message[]>;
}
```

### 4. Adapter (Implementation) = v1 API calls

```typescript
// src/infrastructure/repositories/ApiConversationRepository.ts
import type { ConversationRepository } from "@/domain/ports/ConversationRepository";
import type { Conversation, Message } from "@/domain/models";
import { apiClient } from "../api/client";
import { ConversationApiMapper } from "../mappers/ConversationApiMapper";

export class ApiConversationRepository implements ConversationRepository {
  async create(input: { merchantId: string; customerId: string }): Promise<Conversation> {
    // Call v1 API
    const response = await apiClient.post("/v1/checkouts", {
      merchant_id: input.merchantId,
      customer_id: input.customerId,
    });

    // Transform response → domain model
    return ConversationApiMapper.toDomain(response.data);
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
  }): Promise<Message> {
    // Call v1 API
    const response = await apiClient.post(
      `/v1/checkouts/${input.conversationId}/messages`,
      { text: input.text }
    );

    return ConversationApiMapper.messageToDomain(response.data);
  }

  async getHistory(conversationId: string): Promise<Message[]> {
    const response = await apiClient.get(
      `/v1/checkouts/${conversationId}/messages`
    );

    return response.data.map(m => ConversationApiMapper.messageToDomain(m));
  }
}
```

### 5. Hook = ViewModel ↔ React

```typescript
// src/presentation/hooks/useConversationViewModel.ts
import { useEffect, useState, useCallback } from "react";
import type { ConversationViewModelState } from "@/application/viewmodels/ConversationViewModel";
import { ConversationViewModel } from "@/application/viewmodels/ConversationViewModel";
import { ApiConversationRepository } from "@/infrastructure/repositories/ApiConversationRepository";
import { ApiCartRepository } from "@/infrastructure/repositories/ApiCartRepository";

export function useConversationViewModel() {
  const [state, setState] = useState<ConversationViewModelState>({
    messages: [],
    currentMessage: "",
    isLoading: false,
    error: null,
    cart: null,
    conversationId: null,
  });

  const viewModel = useCallback(() => {
    return new ConversationViewModel(
      new ApiConversationRepository(),
      new ApiCartRepository()
    );
  }, []);

  useEffect(() => {
    const vm = viewModel();
    const unsubscribe = vm.subscribe(() => setState({ ...vm.state }));
    return unsubscribe;
  }, [viewModel]);

  return {
    ...state,
    startConversation: (merchantId, customerId) =>
      viewModel().startConversation(merchantId, customerId),
    sendMessage: (text) => viewModel().sendMessage(text),
    updateCartItem: (variantId, quantity) =>
      viewModel().updateCartItem(variantId, quantity),
  };
}
```

### 6. Component = UI ONLY

```typescript
// src/presentation/components/ConversationShell.tsx
"use client";

import { useConversationViewModel } from "../hooks/useConversationViewModel";
import MessageBubble from "./MessageBubble";
import CartSummary from "./CartSummary";

export function ConversationShell({ merchantId }: { merchantId: string }) {
  const {
    messages,
    currentMessage,
    isLoading,
    error,
    cart,
    startConversation,
    sendMessage,
    updateCartItem,
  } = useConversationViewModel();

  return (
    <div className="conversation">
      {error && <div className="error">{error}</div>}

      <div className="messages">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {cart && (
        <CartSummary
          cart={cart}
          onUpdateItem={updateCartItem}
          isLoading={isLoading}
        />
      )}

      <input
        value={currentMessage}
        onChange={e => /* update viewmodel state */}
        disabled={isLoading}
        placeholder="Type a message..."
      />
      <button
        onClick={() => sendMessage(currentMessage)}
        disabled={isLoading || !currentMessage}
      >
        Send
      </button>
    </div>
  );
}
```

---

## Benefits After Refactor

| Aspect | Before | After |
|--------|--------|-------|
| **Component size** | 900+ lines mixed | 100–200 lines UI only |
| **Testability** | Hard (fetch mocks) | Easy (mock repositories) |
| **API migration** | Edit 20+ files | Update 1 adapter class |
| **Code reuse** | Services duplicated | Services shared across UI |
| **Endpoint change** | Scatter all files | Change mapper only |
| **New repository** | Rewrite component | New adapter, same interface |
| **Dependency injection** | Implicit (hardcoded fetch) | Explicit (constructor params) |

---

## Implementation Phases

### Phase 1: Infrastructure Setup
1. Create `src/infrastructure/api/client.ts` (HTTP client with v1 config)
2. Create `src/app/api/proxy/route.ts` (API gateway for client-side)
3. Create port interfaces in `src/domain/ports/`
4. Create adapters in `src/infrastructure/repositories/`

### Phase 2: Catalog Services (Read-Only)
1. Create `CatalogService`, `CatalogViewModel`
2. Refactor `ProductCarouselBlock.tsx`, `useMarketplaceSearch.ts`
3. Test with v1 API

### Phase 3: Cart Services
1. Create `CartService`, `CartViewModel`
2. Refactor `cart-store.tsx` → repository pattern
3. Update components

### Phase 4: Checkout/Conversation Services
1. Create `ConversationService`, `ConversationViewModel`
2. Refactor `ConversationShell.tsx` (913 → 150 lines)
3. Extract business logic to service

### Phase 5: Buyer Services (Keep Internal Auth)
1. Create `BuyerService`, `BuyerViewModel`
2. Refactor `BuyerHub.tsx`, `BuyerRegistrationForm.tsx`
3. Use internal repository adapter (no migration yet)

### Phase 6: Support Services
1. Create `SupportService`, `SupportViewModel`
2. Refactor `SupportPanel.tsx`
3. Keep WebSocket internal

---

## Dependency Injection Strategy

### Option A: Service Locator (Simpler now, harder later)

```typescript
// Global singleton
const repositories = {
  conversation: new ApiConversationRepository(),
  cart: new ApiCartRepository(),
};

// Used in hooks
export function useConversationViewModel() {
  const vm = new ConversationViewModel(
    repositories.conversation,
    repositories.cart
  );
  // ...
}
```

**Pros**: Quick, no dependency passing
**Cons**: Tight coupling, hard to test

### Option B: React Context (Testable, explicit)

```typescript
// src/lib/RepositoryContext.tsx
export const RepositoryContext = createContext({
  conversation: new ApiConversationRepository(),
  cart: new ApiCartRepository(),
  buyer: new ApiBuyerRepository(),
});

// In root layout
<RepositoryContext.Provider value={repositories}>
  {children}
</RepositoryContext.Provider>

// In hook
export function useConversationViewModel() {
  const repos = useContext(RepositoryContext);
  const vm = new ConversationViewModel(repos.conversation, repos.cart);
  // ...
}
```

**Pros**: Testable (mock context), explicit
**Cons**: Slight overhead

**RECOMMENDATION**: Use Option B — easier testing, env-aware repository selection.

---

## Testing Strategy (Before/After)

### Before (Hard to test)

```typescript
// ❌ Can't unit test — fetch is baked in
export function ConversationShell() {
  // ...
  const res = await fetch(`${API_BASE}/storefront/conversations`, ...);
  // ...
}

// Test must mock fetch globally or use Cypress
test("conversation loads", async () => {
  global.fetch = jest.fn(...) // 😫 Global mock
  render(<ConversationShell />);
  await waitFor(() => expect(...));
});
```

### After (Easy to test)

```typescript
// ✅ Test ViewModel with mock repository
test("conversation sends message", async () => {
  const mockRepo = {
    sendMessage: jest.fn().mockResolvedValue({ id: "msg_1", text: "hi" }),
  };

  const vm = new ConversationViewModel(mockRepo, /* ... */);
  await vm.sendMessage("hello");

  expect(vm.state.messages).toHaveLength(1);
  expect(mockRepo.sendMessage).toHaveBeenCalledWith({
    conversationId: expect.any(String),
    text: "hello",
  });
});

// ✅ Test component with mock hook
test("message renders", () => {
  const mockVM = {
    messages: [{ id: "1", text: "hi", role: "agent" }],
    sendMessage: jest.fn(),
  };

  jest.mock("../hooks/useConversationViewModel", () => ({
    useConversationViewModel: () => mockVM,
  }));

  render(<ConversationShell merchantId="m_123" />);
  expect(screen.getByText("hi")).toBeInTheDocument();
});
```

---

## Summary: What Changes for Migration

| File | Before | After |
|------|--------|-------|
| `ConversationShell.tsx` | 913 lines, fetch calls | 150 lines, useViewModel hook only |
| `BuyerHub.tsx` | 884 lines, mixed logic | 200 lines, useViewModel + UI |
| `cart-store.tsx` | Context + fetch | CartRepository port + ApiCartRepository adapter |
| New: `ConversationViewModel` | — | 150 lines, state + orchestration |
| New: `ConversationService` | — | 80 lines, business logic |
| New: `ApiConversationRepository` | — | 80 lines, v1 API calls |
| New: `ConversationApiMapper` | — | 50 lines, response → domain |
| New: `api-client.ts` | — | 40 lines, HTTP client wrapper |

**Net effect:**
- Total lines increase slightly (~1000 new lines for new files)
- Component complexity decreases dramatically (50–80% reduction in component logic)
- **Testability** jumps from 0% to 90%+
- **Maintainability** jumps from hard to easy
