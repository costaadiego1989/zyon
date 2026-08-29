import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { PrismaClient } from "@prisma/client";

export interface OrderHandlerDeps {
  prisma: PrismaClient;
}

export function createOrderHandlers(deps: OrderHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "trackOrder" | "getInvoice" | "cancelOrder" | "getStorePolicies" | "getBuyerProfile"> {
  return {
    trackOrder: async (args: any) => {
      return {
        orderId: args.orderId,
        status: "in_transit",
        statusLabel: "Em trânsito",
        trackingCode: "BR123456789XX",
        carrier: "Correios - Sedex",
        estimatedDelivery: "2026-08-20",
        lastUpdate: "Objeto saiu para entrega"
      };
    },

    getStorePolicies: async (args: any) => {
      const policies: Record<string, string> = {
        returns: "Aceitamos devoluções em até 7 dias após o recebimento. O produto deve estar em sua embalagem original.",
        exchanges: "Trocas podem ser solicitadas em até 30 dias. Produtos com defeito são trocados sem custo adicional.",
        shipping: "Enviamos para todo o Brasil. Prazo de entrega varia de 2 a 10 dias úteis dependendo da região.",
        warranty: "Todos os produtos possuem garantia de 12 meses contra defeitos de fabricação."
      };
      if (args.policyType && args.policyType !== "all") {
        return { policy: policies[args.policyType] ?? "Política não encontrada." };
      }
      return { policies };
    },

    getBuyerProfile: async () => {
      return {
        message: "Você pode visualizar seus dados e histórico na seção de perfil. Posso ajudar com algo específico?"
      };
    },

    getInvoice: async (args: any) => {
      return {
        orderId: args.orderId,
        invoiceUrl: `https://nf.example.com/${args.orderId}`,
        number: `NF-${args.orderId.slice(-6)}`,
        issuedAt: "2026-08-14",
        message: "Nota fiscal disponível no link acima."
      };
    },

    cancelOrder: async (args: any) => {
      return {
        orderId: args.orderId,
        status: "cancellation_requested",
        message: "Solicitação de cancelamento registrada. Você receberá confirmação por e-mail em até 24h.",
        reason: args.reason ?? "Solicitado pelo cliente"
      };
    }
  };
}
