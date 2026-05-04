import type { CommerceCartPort as CommerceCartAdapterPort } from "@aacp/commerce-adapters";

/** Token DI para a porta de validação de carrinho (pacote `@aacp/commerce-adapters`). */
export const COMMERCE_CART_PORT = Symbol("COMMERCE_CART_PORT");

export type CommerceCartPort = CommerceCartAdapterPort;
