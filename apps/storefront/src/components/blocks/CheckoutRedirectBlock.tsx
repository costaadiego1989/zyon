"use client";

// Legacy: checkout_redirect blocks are no longer rendered inline.
// The checkout flow is handled natively by the CartSheet + conversation agent.
// This file is kept for backwards compatibility but renders nothing.

export default function CheckoutRedirectBlock() {
  return null;
}
