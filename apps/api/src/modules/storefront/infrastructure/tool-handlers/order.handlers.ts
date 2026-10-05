import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { PrismaClient } from "@prisma/client";
import { resolveStorePolicies } from "../../../../shared/legal/store-policies.js";

export interface OrderHandlerDeps {
  prisma: PrismaClient;
}

type TrackingStatus =
  | "pending"
  | "processing"
  | "approved"
  | "paid"
  | "created"
  | "label_generated"
  | "dispatched"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "cancelled";

const STATUS_LABELS: Record<TrackingStatus, string> = {
  pending: "Aguardando pagamento",
  processing: "Pedido em preparação",
  approved: "Pagamento aprovado",
  paid: "Pagamento aprovado",
  created: "Envio em preparação",
  label_generated: "Etiqueta de envio gerada",
  dispatched: "Pedido despachado",
  in_transit: "Em trânsito",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  returned: "Devolvido",
  cancelled: "Cancelado",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status as TrackingStatus] ?? status;
}

function toIso(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function isTrackingCodeAvailable(code: string | null): boolean {
  return Boolean(code && !code.startsWith("pending:"));
}

export function createOrderHandlers(deps: OrderHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "trackOrder" | "getInvoice" | "cancelOrder" | "getStorePolicies" | "getBuyerProfile"> {
  return {
    trackOrder: async (args: any) => {
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) {
        return { found: false, message: "Informe o número do pedido para consultar o rastreamento." };
      }
      if (!ctx.buyer?.globalUserId) {
        return {
          found: false,
          requiresIdentification: true,
          message: "Para proteger seus dados, entre na sua conta antes de consultar um pedido.",
        };
      }

      const order = await deps.prisma.completedOrder.findFirst({
        where: {
          merchantId: ctx.merchantId,
          externalOrderId: orderId,
          session: { globalUserId: ctx.buyer.globalUserId },
        },
        select: { externalOrderId: true, status: true, completedAt: true },
      });
      if (!order) {
        return {
          orderId,
          found: false,
          message: "Não encontrei esse pedido na sua conta.",
        };
      }

      const shipment = await deps.prisma.shipment.findFirst({
        where: { merchantId: ctx.merchantId, externalOrderId: order.externalOrderId },
        select: {
          id: true,
          carrier: true,
          trackingCode: true,
          trackingUrl: true,
          status: true,
          estimatedEta: true,
          deliveredAt: true,
          updatedAt: true,
        },
      });
      if (!shipment) {
        return {
          orderId: order.externalOrderId,
          found: true,
          status: order.status,
          statusLabel: statusLabel(order.status),
          trackingAvailable: false,
          completedAt: toIso(order.completedAt),
          message: "Seu pedido foi confirmado e ainda não possui rastreamento disponível.",
        };
      }

      const latestEvent = await deps.prisma.trackingEvent.findFirst({
        where: { merchantId: ctx.merchantId, shipmentId: shipment.id },
        orderBy: { occurredAt: "desc" },
        select: { description: true, occurredAt: true },
      });
      const trackingAvailable = isTrackingCodeAvailable(shipment.trackingCode);
      return {
        orderId: order.externalOrderId,
        found: true,
        status: shipment.status,
        statusLabel: statusLabel(shipment.status),
        trackingAvailable,
        trackingCode: trackingAvailable ? shipment.trackingCode : undefined,
        trackingUrl: trackingAvailable ? shipment.trackingUrl ?? undefined : undefined,
        carrier: shipment.carrier,
        estimatedDelivery: toIso(shipment.estimatedEta),
        deliveredAt: toIso(shipment.deliveredAt),
        lastUpdate: latestEvent?.description ?? statusLabel(shipment.status),
        lastUpdatedAt: toIso(latestEvent?.occurredAt ?? shipment.updatedAt),
      };
    },

    getStorePolicies: async (args: any) => {
      const [merchant, legacy] = await Promise.all([
        deps.prisma.merchant.findUnique({ where: { id: ctx.merchantId }, select: { storeSettings: true } }),
        deps.prisma.merchantPolicy.findUnique({ where: { merchantId: ctx.merchantId } }),
      ]);
      const policies = resolveStorePolicies(merchant?.storeSettings, legacy);
      if (policies.returns) policies.exchanges = policies.returns;
      const message = "A loja ainda não publicou essa política. Consulte o atendimento da loja; isso não afasta seus direitos legais. Não há prazo ou garantia comercial confirmado nesta consulta.";
      if (args.policyType && args.policyType !== "all") {
        const policy = policies[args.policyType];
        return policy ? { configured: true, policy } : { configured: false, policy: null, message };
      }
      return { configured: Object.keys(policies).length > 0, policies, ...(Object.keys(policies).length ? {} : { message }) };
    },

    getBuyerProfile: async () => {
      return {
        message: "Você pode visualizar seus dados e histórico na seção de perfil. Posso ajudar com algo específico?"
      };
    },

    getInvoice: async (args: any) => {
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) {
        return { invoiceAvailable: false, message: "Informe o número do pedido para verificar a nota fiscal." };
      }
      // No fiscal-document model exists for a completed order. Payment-provider
      // URLs are payment artifacts, not NF-e documents, so never present them
      // as an invoice to the buyer.
      return {
        orderId,
        invoiceAvailable: false,
        message: "A nota fiscal não está disponível pelo assistente. Solicite-a ao atendimento da loja.",
      };
    },

    cancelOrder: async (args: any) => {
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) {
        return { cancellationAvailable: false, message: "Informe o número do pedido para solicitar o cancelamento." };
      }
      // Cancellation must use CancelOrderUseCase, which performs order-state,
      // commerce-provider and webhook effects. This public conversation does
      // not carry authenticated buyer identity, so it cannot invoke that path.
      return {
        orderId,
        cancellationAvailable: false,
        status: "unavailable",
        message: "O cancelamento não está disponível pelo assistente. Fale com o atendimento da loja para uma solicitação autorizada.",
      };
    }
  };
}
