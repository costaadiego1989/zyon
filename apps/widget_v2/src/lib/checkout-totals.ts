export type CheckoutTotalsInput = {
  subtotal: number;
  shipping?: number;
  discount?: number;
  serviceFee?: number;
};

type ServiceFeeCopy = {
  label: string;
  notice: string;
};

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The service fee is supplied by the signed checkout experience. Invalid or
 * missing values stay at zero: the UI must never invent a buyer charge.
 */
export function buyerServiceFeeFrom(value: unknown): number {
  return isNonNegativeFinite(value) ? value : 0;
}

export function checkoutTotalWithServiceFee({ subtotal, shipping = 0, discount = 0, serviceFee = 0 }: CheckoutTotalsInput): number {
  const total =
    (isNonNegativeFinite(subtotal) ? subtotal : 0) +
    (isNonNegativeFinite(shipping) ? shipping : 0) -
    (isNonNegativeFinite(discount) ? discount : 0) +
    buyerServiceFeeFrom(serviceFee);
  return Math.max(0, Math.round((total + Number.EPSILON) * 100) / 100);
}

export function checkoutLocale(language?: string): string {
  const normalized = language?.toLowerCase() ?? "";
  if (normalized.startsWith("en")) return "en-US";
  if (normalized.startsWith("es")) return "es-ES";
  return "pt-BR";
}

export function buyerServiceFeeCopy(language?: string): ServiceFeeCopy {
  const normalized = language?.toLowerCase() ?? "";
  if (normalized.startsWith("en")) {
    return {
      label: "Zyon service fee",
      notice: "Charged by Zyon and included in the total due.",
    };
  }
  if (normalized.startsWith("es")) {
    return {
      label: "Tarifa de servicio de Zyon",
      notice: "Cobrada por Zyon e incluida en el total a pagar.",
    };
  }
  return {
    label: "Taxa de serviço Zyon",
    notice: "Cobrada pela Zyon e incluída no total a pagar.",
  };
}
