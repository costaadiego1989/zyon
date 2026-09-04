# Widget V2 Full MVVM Professional — Design

## Architecture: MVVM + Error Handling

```
┌──────────────────────────────────────────┐
│      COMPONENTS (Pure Render)            │
│  ChatPanel, SupportPanel, etc.           │
│  Props: { vm: ViewModel, ... }           │
└────────────┬─────────────────────────────┘
             │ use hooks (inject VM)
             ↓
┌──────────────────────────────────────────┐
│      VIEW MODELS (Business Logic)        │
│  useChatViewModel, useSupportViewModel   │
│  - State management (messages, input)    │
│  - Actions (sendMessage, submitChat)     │
│  - Derived state (isLoading, canSend)    │
│  - Error handling (reportError)          │
└────────┬─────────────────────────────────┘
         │ delegate + report
         ↓
  ┌──────────────────┬───────────────────┐
  │   API Clients    │   Error Handler   │
  │ (api/*.ts)       │  (reportError)    │
  └──────────────────┴───────────────────┘
         │                    │
         ↓                    ↓
    ┌─────────────┐  ┌──────────────────┐
    │ Store       │  │ UI Feedback      │
    │ (Zustand)   │  │ (Toast/Modal)    │
    └─────────────┘  └──────────────────┘
```

### Dependency Direction (Acyclic)

```
Components → ViewModels → (API clients + Error handler) → Store
```

**NO circular deps. NO component-to-component direct communication.**

---

## ViewModel Interfaces

### ChatViewModelInterface

```ts
export interface ChatViewModelInterface {
  // State
  messages: Message[];
  input: string;
  loading: boolean;
  error: string | null;
  currentStep: CryptoStep | "idle";  // crypto flow
  wallet: string;
  
  // Actions
  setInput: (text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
  
  // Crypto flow
  connectWallet: (chain: string) => Promise<void>;
  confirmCryptoPayment: (txHash: string) => Promise<void>;
  
  // Derived (computed)
  canSend: boolean;
  isProcessing: boolean;
}

export function useChatViewModel(
  store: ReturnType<typeof useCheckoutStore>,
  apiClients?: { payment?: PaymentClient }  // dependency injection
): ChatViewModelInterface {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<CryptoStep>("idle");
  const [wallet, setWallet] = useState("");

  const sendMessage = useCallback(async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      // call api, update state
      // on error: reportError(err, "ChatPanel.sendMessage")
    } catch (err) {
      reportError(err, "sendMessage");
    } finally {
      setLoading(false);
    }
  }, [store.sessionId, store.merchantId]);

  const canSend = input.trim().length > 0 && !loading;
  const isProcessing = loading || currentStep !== "idle";

  return {
    messages,
    input,
    loading,
    error,
    currentStep,
    wallet,
    setInput,
    sendMessage,
    clearHistory: () => setMessages([]),
    connectWallet,
    confirmCryptoPayment,
    canSend,
    isProcessing,
  };
}
```

### SupportViewModelInterface

```ts
export interface SupportViewModelInterface {
  // State
  messages: SupportMessage[];
  input: string;
  loading: boolean;
  view: "welcome" | "chat";
  faqItems: FaqItem[];
  ticketId: string | null;
  error: string | null;

  // Actions
  loadFaq: () => Promise<void>;
  setInput: (text: string) => void;
  sendMessage: (text: string) => Promise<void>;
  switchToChat: () => void;
  switchToWelcome: () => void;

  // Derived
  hasTicket: boolean;
}

export function useSupportViewModel(
  store: ReturnType<typeof useCheckoutStore>,
  apiClients?: { support?: SupportClient }
): SupportViewModelInterface {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"welcome" | "chat">("welcome");
  const [faqItems, setFaqItems] = useState<FaqItem[]>(DEFAULT_FAQ);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    loadFaq();
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const hasTicket = ticketId !== null;

  return {
    messages,
    input,
    loading,
    view,
    faqItems,
    ticketId,
    error,
    loadFaq,
    setInput,
    sendMessage,
    switchToChat: () => setView("chat"),
    switchToWelcome: () => setView("welcome"),
    hasTicket,
  };
}
```

### PaymentViewModelInterface

```ts
export interface PaymentViewModelInterface {
  processing: boolean;
  error: string | null;
  success: boolean;
  confirmStripePayment: (paymentMethodId: string) => Promise<void>;
}

export function usePaymentViewModel(
  store: ReturnType<typeof useCheckoutStore>,
  apiClients?: { payment?: PaymentClient }
): PaymentViewModelInterface {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const confirmStripePayment = useCallback(async (pmId: string) => {
    setProcessing(true);
    setError(null);
    try {
      const res = await confirmStripePayment(store.api, { paymentIntentId: store.paymentIntent.id, stripePaymentId: pmId });
      if (res.ok) {
        setSuccess(true);
        store.markPaymentComplete();
      } else {
        reportError(new Error("Stripe confirmation failed"), "Payment.confirm");
      }
    } catch (err) {
      reportError(err, "confirmStripePayment");
    } finally {
      setProcessing(false);
    }
  }, [store]);

  return { processing, error, success, confirmStripePayment };
}
```

---

## Error Handler Service

**File:** `src/lib/error-handler.ts`

```ts
export interface ErrorContext {
  context: string;           // "ChatPanel.sendMessage", "SupportPanel.loadFaq"
  userId?: string;
  sessionId?: string;
  details?: Record<string, any>;
}

export function reportError(error: unknown, context: string, details?: Record<string, any>) {
  const err = error instanceof Error ? error : new Error(String(error));
  
  // Log to console (dev)
  console.error(`[${context}]`, err.message, details);

  // Parse API error → user-friendly message
  const userMessage = parseErrorMessage(err);

  // Store error state (optional: Sentry, LogRocket)
  // logToSentry(err, { context, details });

  // UI feedback (toast/modal)
  showErrorNotification(userMessage);

  // Return parsed error for ViewModel to handle
  return { message: userMessage, original: err };
}

function parseErrorMessage(err: Error): string {
  if (err.message.includes("Network")) return "Erro de conexão. Verifique sua internet.";
  if (err.message.includes("401") || err.message.includes("Unauthorized")) return "Sessão expirada. Recarregue a página.";
  if (err.message.includes("403") || err.message.includes("Forbidden")) return "Você não tem permissão para esta ação.";
  if (err.message.includes("404")) return "Recurso não encontrado.";
  if (err.message.includes("500")) return "Erro no servidor. Tente novamente em instantes.";
  return "Algo deu errado. Tente novamente.";
}

function showErrorNotification(message: string) {
  // TODO: integrate with toast lib (react-toastify, sonner, etc.)
  console.warn("SHOW TOAST:", message);
}
```

---

## Component Refactoring: ChatPanel → 3 Files

### File 1: `ChatPanel.tsx` (≤100 lines, orchestrator)

```tsx
import { useChatViewModel } from "@/viewModels/useChatViewModel";
import { useCheckoutStore } from "@/store/checkout-store";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

export function ChatPanel() {
  const store = useCheckoutStore();
  const vm = useChatViewModel(store);

  return (
    <div className="chat-panel">
      <ChatMessages messages={vm.messages} loading={vm.loading} error={vm.error} />
      <ChatInput
        input={vm.input}
        onInput={vm.setInput}
        onSend={vm.sendMessage}
        disabled={!vm.canSend}
        isProcessing={vm.isProcessing}
      />
    </div>
  );
}
```

### File 2: `ChatMessages.tsx` (≤80 lines, pure render)

```tsx
interface ChatMessagesProps {
  messages: Message[];
  loading: boolean;
  error: string | null;
}

export function ChatMessages({ messages, loading, error }: ChatMessagesProps) {
  return (
    <div className="chat-messages">
      {error && <div className="chat-error">{error}</div>}
      {messages.map((msg) => (
        <div key={msg.id} className={`message message--${msg.role}`}>
          {msg.text}
        </div>
      ))}
      {loading && <div className="chat-loading">Digitando...</div>}
    </div>
  );
}
```

### File 3: `ChatInput.tsx` (≤70 lines, pure render)

```tsx
interface ChatInputProps {
  input: string;
  onInput: (text: string) => void;
  onSend: (text: string) => Promise<void>;
  disabled: boolean;
  isProcessing: boolean;
}

export function ChatInput({ input, onInput, onSend, disabled, isProcessing }: ChatInputProps) {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    await onSend(input);
    onInput("");
  };

  return (
    <form onSubmit={handleSubmit} className="chat-input">
      <input
        value={input}
        onChange={(e) => onInput(e.target.value)}
        placeholder="Escreva sua mensagem..."
        disabled={disabled || isProcessing}
      />
      <button type="submit" disabled={disabled || isProcessing}>
        {isProcessing ? "Enviando..." : "Enviar"}
      </button>
    </form>
  );
}
```

### Same pattern for SupportPanel + StripeCardPayment

---

## Testing Strategy

### ViewModel Tests (Jest + @testing-library/react-hooks)

```ts
describe("useChatViewModel", () => {
  it("sends message and updates state", async () => {
    const store = mockCheckoutStore();
    const { result } = renderHook(() => useChatViewModel(store));

    await act(async () => {
      result.current.setInput("Hello");
      await result.current.sendMessage("Hello");
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.input).toBe("");
  });

  it("calls reportError on failure", async () => {
    const store = mockCheckoutStore();
    const { result } = renderHook(() => useChatViewModel(store));

    // Mock API failure
    mockApiError();

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(reportError).toHaveBeenCalled();
  });
});
```

### Component Tests (Render + interact)

```ts
describe("ChatPanel", () => {
  it("renders messages from ViewModel", () => {
    const mockVm = mockChatViewModel();
    render(<ChatPanel vm={mockVm} />);

    expect(screen.getByText("Message 1")).toBeInTheDocument();
  });
});
```

### E2E Tests (Playwright, existing)

Remain unchanged — test full flow end-to-end.

---

## File Structure (After)

```
src/
├── api/
│   ├── checkout-session.ts    (existing)
│   ├── payment.ts             (existing)
│   └── support.ts             (existing)
│
├── viewModels/                (NEW)
│   ├── index.ts               (exports all VMs)
│   ├── types.ts               (interfaces)
│   ├── useChatViewModel.ts
│   ├── useSupportViewModel.ts
│   └── usePaymentViewModel.ts
│
├── components/
│   ├── ChatPanel.tsx          (refactored: 80 lines)
│   ├── ChatMessages.tsx       (NEW: 60 lines)
│   ├── ChatInput.tsx          (NEW: 50 lines)
│   │
│   ├── SupportPanel.tsx       (refactored: 90 lines)
│   ├── SupportMessages.tsx    (NEW: 70 lines)
│   │
│   ├── StripeCardPayment.tsx  (refactored: 90 lines)
│   └── ... (others, unchanged)
│
├── lib/
│   ├── error-handler.ts       (NEW)
│   └── ... (existing)
│
├── store/
│   └── checkout-store.ts      (existing, unchanged)
│
└── ... (styles, layouts, etc.)
```

---

## Professional Patterns Checklist

- ✅ **MVVM:** ViewModel encapsulates logic, components render only
- ✅ **DI:** Hooks accept store/clients as args
- ✅ **Composition:** ViewModels compose hooks (useMemo, useCallback)
- ✅ **Error Handling:** Centralized reportError service
- ✅ **Types:** Interfaces for VMs, no any
- ✅ **Testability:** VMs testable in isolation
- ✅ **Component Size:** All ≤150 lines
- ✅ **Separation:** Business logic ≠ render logic

---

**Status:** Design complete, ready for Tasks breakdown
