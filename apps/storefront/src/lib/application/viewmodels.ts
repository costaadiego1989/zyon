import { useCallback, useEffect, useRef, useState } from "react";
export abstract class BaseViewModel<TState> {
  state: TState;
  protected listeners = new Set<() => void>();
  constructor(initialState: TState) {
    this.state = initialState;
  }
  protected notify() {
    this.listeners.forEach(l => l());
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  abstract dispose(): void;
}

export function useViewModel<TViewModel extends BaseViewModel<any>>(
  factory: () => TViewModel,
): TViewModel {
  const vmRef = useRef<TViewModel | null>(null);
  const [state, setState] = useState(() => {
    vmRef.current = factory();
    return vmRef.current.state;
  });
  useEffect(() => {
    const vm = vmRef.current!;
    const unsubscribe = vm.subscribe(() => {
      setState({ ...vm.state });
    });
    return () => {
      unsubscribe();
      vm.dispose();
    };
  }, []);
  return vmRef.current!;
}
export interface CatalogState {
  products: any[];
  selectedProduct: any | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  cursor: string | null;
  hasMore: boolean;
}
export class CatalogViewModel extends BaseViewModel<CatalogState> {
  constructor(private catalogRepo: any) {
    super({
      products: [],
      selectedProduct: null,
      isLoading: false,
      error: null,
      searchQuery: "",
      cursor: null,
      hasMore: false,
    });
  }
  async loadProducts(query?: string) {
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();
    try {
      const products = await this.catalogRepo.listProducts({
        search: query || this.state.searchQuery,
        limit: 20,
      });
      this.state.products = products;
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to load products";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }
  setSearchQuery(query: string) {
    this.state.searchQuery = query;
    this.notify();
  }
  async selectProduct(id: string) {
    try {
      this.state.selectedProduct = await this.catalogRepo.getProduct(id);
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to load product";
    }
    this.notify();
  }
  dispose() {
    this.listeners.clear();
  }
}
export interface CartState {
  cartId: string | null;
  items: Array<{ variantId: string; quantity: number; price: number }>;
  total: number;
  isLoading: boolean;
  error: string | null;
}

export class CartViewModel extends BaseViewModel<CartState> {
  constructor(private cartRepo: any, cartId: string | null) {
    super({
      cartId,
      items: [],
      total: 0,
      isLoading: false,
      error: null,
    });
    if (cartId) {
      this.loadCart();
    }
  }
  async loadCart() {
    if (!this.state.cartId) return;
    this.state.isLoading = true;
    this.notify();
    try {
      const cart = await this.cartRepo.get(this.state.cartId);
      this.state.items = cart.items ?? [];
      this.state.total = cart.total ?? 0;
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to load cart";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }
  async updateItem(variantId: string, quantity: number) {
    if (!this.state.cartId) return;
    try {
      const updated = await this.cartRepo.updateItem({
        cartId: this.state.cartId,
        variantId,
        quantity,
      });
      this.state.items = updated.items ?? [];
      this.state.total = updated.total ?? 0;
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to update cart";
    }
    this.notify();
  }
  dispose() {
    this.listeners.clear();
  }
}
export interface ConversationState {
  conversationId: string | null;
  messages: Array<{ id: string; role: "user" | "agent"; text: string }>;
  userInput: string;
  isLoading: boolean;
  error: string | null;
}
export class ConversationViewModel extends BaseViewModel<ConversationState> {
  constructor(private convRepo: any) {
    super({
      conversationId: null,
      messages: [],
      userInput: "",
      isLoading: false,
      error: null,
    });
  }

  async start(merchantId: string, customerId: string) {
    this.state.isLoading = true;
    this.notify();
    try {
      const conv = await this.convRepo.create({ merchantId, customerId });
      this.state.conversationId = conv.id;
      this.state.messages = conv.messages ?? [];
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to start conversation";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }
  setUserInput(text: string) {
    this.state.userInput = text;
    this.notify();
  }

  async sendMessage() {
    if (!this.state.conversationId || !this.state.userInput) return;
    const text = this.state.userInput;
    this.state.userInput = "";
    this.state.isLoading = true;
    this.notify();
    try {
      const msg = await this.convRepo.sendMessage({
        conversationId: this.state.conversationId,
        text,
      });
      this.state.messages.push(msg);
      this.state.error = null;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : "Failed to send message";
    } finally {
      this.state.isLoading = false;
      this.notify();
    }
  }
  dispose() {
    this.listeners.clear();
  }
}
