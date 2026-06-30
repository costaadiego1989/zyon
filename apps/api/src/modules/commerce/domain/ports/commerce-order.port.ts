import type { CommerceOrderPort as CommerceOrderAdapterPort } from "@zyon/commerce-adapters";

/** Token DI para criação de ordem pendente na plataforma de commerce (`@zyon/commerce-adapters`). */
export const COMMERCE_ORDER_PORT = Symbol("COMMERCE_ORDER_PORT");

export type CommerceOrderPort = CommerceOrderAdapterPort;
