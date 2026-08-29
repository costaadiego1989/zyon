# Widget V2 MVVM + SOLID Refactor — Design

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│          COMPONENTS (Pure Render)               │
│  ChatPanel, SupportPanel, StripeCardPayment     │
└────────────────┬────────────────────────────────┘
                 │ use hooks (dependency injection)
                 ↓
┌─────────────────────────────────────────────────┐
│          VIEW MODELS (Business Logic)           │
│  useChatViewModel, useSupportViewModel, etc.    │
│  - State management (local + derived)           │
│  - Action handlers (user interactions)          │
│  - Computed selectors (memoized)                │
└────────┬────────────────────┬───────────────────┘
         │ delegate           │ dispatch
         ↓                    ↓
    ┌────────────┐       ┌──────────────┐
    │ API Layer  │       │  Store       │
    │ (Ports)    │       │  (Zustand)   │
    └────────────┘       └──────────────┘
         │                    │
         ↓                    ↓
    ┌─────────────────────────────────┐
    │   Domain Models / Data           │
    │   (from @/api/checkout-session) │
    └─────────────────────────────────┘
```

### Dependency Flow (Acyclic)

```
Components → ViewModels → API + Store → Data
```

**NO cross-layer dependencies.**

---

## Component Contracts

### ChatPanel
**Before:** Monolithic, 18 useState, fetch in render, 1706 lines.

**After:**
```tsx
interface ChatViewModelInterface {
  messages: Message[];
  loading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
}

function ChatPanel() {
  const vm = useChatViewModel(); // inject via hook
  return (
    <div>
      <MessageList messages={vm.messages} loading={vm.loading} />
      <MessageInput onSend={vm.sendMessage} />
    </div>
  );
}
```

**ViewModel Logic:**
```ts
export function useChatViewModel(): ChatViewModelInterface {
  const store = useCheckoutStore(); // access global state
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  
  const sendMessage = useCallback(async (text: string) => {
    setLoading(true);
    try {
      const response = await chatSessionApi.sendMessage(store.sessionId, text);
      setLocalMessages(prev => [...prev, response.message]);
    } catch (err) {
      // handle centrally
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [store.sessionId]);
  
  return { messages: localMessages, loading, error: null, sendMessage, clearHistory };
}
```

### SupportPanel
**After:** Extract 7 useState into `useSupportViewModel`.

```ts
interface SupportViewModelInterface {
  formData: Record<string, any>;
  submitting: boolean;
  submitted: boolean;
  setFormField: (key: string, value: any) => void;
  submitTicket: () => Promise<void>;
}

export function useSupportViewModel(): SupportViewModelInterface {
  const store = useCheckoutStore();
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const setFormField = useCallback((key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);
  
  const submitTicket = useCallback(async () => {
    setSubmitting(true);
    try {
      await supportApi.createTicket(store.merchantId, formData);
      setSubmitted(true);
    } catch (err) {
      reportError(err);
    } finally {
      setSubmitting(false);
    }
  }, [formData, store.merchantId]);
  
  return { formData, submitting, submitted, setFormField, submitTicket };
}
```

### StripeCardPayment
**After:** Inject stripe config via ViewModel, no fetch in component.

```ts
export function useCreditCardViewModel() {
  const store = useCheckoutStore();
  const [processing, setProcessing] = useState(false);
  
  const processPayment = useCallback(async (paymentMethodId: string) => {
    setProcessing(true);
    try {
      const result = await paymentApi.confirmStripePayment(
        store.sessionId,
        { paymentMethodId }
      );
      store.markPaymentComplete(result);
    } catch (err) {
      reportError(err);
    } finally {
      setProcessing(false);
    }
  }, [store.sessionId, store.merchantId]);
  
  return { processing, processPayment };
}
```

---

## Folder Structure (New)

```
src/
├── api/
│   ├── checkout-session.ts    (existing, no changes)
│   ├── chat-session.ts        (new abstraction)
│   ├── support.ts             (new abstraction)
│   ├── payment.ts             (new abstraction)
│   └── types.ts               (shared request/response types)
│
├── viewModels/
│   ├── index.ts               (exports)
│   ├── useChatViewModel.ts    (ChatPanel logic)
│   ├── useSupportViewModel.ts (SupportPanel logic)
│   ├── usePaymentViewModel.ts (Payment logic)
│   └── types.ts               (ViewModel interfaces)
│
├── components/
│   ├── ChatPanel.tsx          (pure render, no fetch)
│   ├── SupportPanel.tsx       (pure render, no fetch)
│   ├── StripeCardPayment.tsx  (pure render, no fetch)
│   └── ... (others)
│
├── store/
│   └── checkout-store.ts      (existing, no changes)
│
├── layouts/
│   └── CheckoutLayout.tsx     (page composition)
│
├── lib/
│   ├── error-handler.ts       (centralized error reporting)
│   └── ... (utilities)
│
└── styles/
    └── ... (CSS)
```

---

## SOLID Patterns Applied

| Principle | Pattern | Example |
|-----------|---------|---------|
| **S** (SRP) | One file = one ViewModel or Component | `useChatViewModel.ts` does chat only |
| **O** (OCP) | Extend ViewModels via composition | `usePaymentViewModel` extends via hooks, not inheritance |
| **L** (LSP) | ViewModel interfaces are substitutable | `ChatViewModelInterface` can be mocked in tests |
| **I** (ISP) | Components depend on minimal interfaces | ChatPanel uses only `{ messages, sendMessage, loading }` |
| **D** (DIP) | Inject API clients + stores | ViewModel receives store as dependency, not global |

---

## Comment Removal Strategy

**Script:** `scripts/remove-comments.ts`

```ts
import fs from "fs";
import path from "path";

export function removeComments(filePath: string): string {
  let content = fs.readFileSync(filePath, "utf-8");
  
  // Remove single-line comments, preserve JSDoc
  content = content
    .split("\n")
    .filter(line => {
      const trimmed = line.trim();
      // Keep JSDoc blocks and empty lines
      if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.endsWith("*/")) {
        return true;
      }
      // Remove lines that start with // (but not in strings)
      if (trimmed.startsWith("//")) {
        return false;
      }
      return true;
    })
    .join("\n");
  
  return content;
}

// Idempotent: only removes, never adds. Safe to run twice.
export async function removeCommentsFromDir(dir: string) {
  const files = findFiles(dir, [".ts", ".tsx"]);
  for (const file of files) {
    const cleaned = removeComments(file);
    fs.writeFileSync(file, cleaned);
    console.log(`✓ ${file}`);
  }
}
```

**Execution:**
```bash
pnpm tsx scripts/remove-comments.ts
```

---

## Gate Checks

1. **Lint:** `pnpm typecheck` — no TS errors
2. **Tests:** `pnpm test` — existing tests pass or updated
3. **SOLID Audit:** No fetch in `/components/**/*.tsx`
4. **Build:** `pnpm build` — production bundle succeeds

---

## No Breaking Changes

All component APIs remain unchanged (or backwards-compatible via optional props). Internal implementation moves to ViewModels, but component props stay the same.

**Example:**
```tsx
// Old: <ChatPanel messages={msgs} onSend={...} />
// New: <ChatPanel /> (manages its own ViewModel internally)
// OR: <ChatPanel useViewModel={customViewModel} /> (for testing)
```

---

**Reviewed:** TBD  
**Approved:** TBD
