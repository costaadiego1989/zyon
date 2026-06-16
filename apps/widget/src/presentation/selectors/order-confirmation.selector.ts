import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-presentation.js";
import type { OrderConfirmationModel } from "../models/order-confirmation.model.js";

export function selectOrderConfirmationModel(vm: CheckoutAgentViewModel): OrderConfirmationModel {
  const summaryItems = vm.completedOrderSnapshot?.items ?? vm.visibleItems;
  const summaryTotals = vm.completedOrderSnapshot?.totals ?? vm.visibleTotals;
  const currency = summaryTotals.currency;
  const fallbackReturnUrl = typeof window !== "undefined" ? window.location.origin : undefined;
  const redirectUrl =
    vm.config.successRedirectUrl ||
    vm.config.storeUrl ||
    vm.config.emptyCartRedirectUrl ||
    fallbackReturnUrl;

  const lines = [
    ...summaryItems.map((item) => ({
      key: item.sku,
      label: `${item.quantity}x ${item.name}`,
      amountLabel: formatCurrency(item.line_total, currency),
    })),
    ...(summaryTotals.shipping > 0
      ? [
          {
            key: "shipping",
            label: "Frete",
            amountLabel: formatCurrency(summaryTotals.shipping, currency),
          },
        ]
      : []),
    ...(summaryTotals.discount > 0
      ? [
          {
            key: "discount",
            label: "Desconto",
            amountLabel: `-${formatCurrency(summaryTotals.discount, currency)}`,
            variant: "discount" as const,
          },
        ]
      : []),
    {
      key: "total",
      label: "Total",
      amountLabel: formatCurrency(summaryTotals.total, currency),
      variant: "total" as const,
    },
  ];

  return {
    sessionRef: vm.session?.session_id?.slice(-6)?.toUpperCase() ?? "------",
    lines,
    redirectUrl,
    redirectLabel: vm.config.successRedirectLabel || "Voltar para a loja",
  };
}
