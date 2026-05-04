import type { CommerceOrderPort as CommerceOrderAdapterPort } from "@aacp/commerce-adapters";

/** Token DI para criação de ordem pendente na plataforma de commerce (`@aacp/commerce-adapters`). */
export const COMMERCE_ORDER_PORT = Symbol("COMMERCE_ORDER_PORT");

export type CommerceOrderPort = CommerceOrderAdapterPort;
