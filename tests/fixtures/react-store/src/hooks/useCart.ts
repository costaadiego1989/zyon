import { useState, useCallback } from "react";

export interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface CartState {
  items: CartItem[];
  addItem: (product: { sku: string; name: string; price: number; image?: string }) => void;
  removeItem: (sku: string) => void;
  clear: () => void;
}

export function useCart(): CartState {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((product: { sku: string; name: string; price: number; image?: string }) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.sku === product.sku);
      if (existing) {
        return prev.map((i) => i.sku === product.sku ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((sku: string) => {
    setItems((prev) => prev.filter((i) => i.sku !== sku));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, addItem, removeItem, clear };
}
