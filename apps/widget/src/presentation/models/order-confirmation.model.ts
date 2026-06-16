export type OrderConfirmationLineModel = {
  key: string;
  label: string;
  amountLabel: string;
  variant?: "discount" | "total";
};

export type OrderConfirmationModel = {
  sessionRef: string;
  lines: OrderConfirmationLineModel[];
  redirectUrl?: string;
  redirectLabel: string;
};
