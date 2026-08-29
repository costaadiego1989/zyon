import { checkoutApi } from "@/lib/api/api-client";
export async function postStorefrontBudgetRequest(body: {
  merchant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items: Array<{ variantId: string; productName: string; quantity: number; price: number }>;
  total: number;
  note?: string;
}) {
  return checkoutApi.create({
    merchantId: body.merchant_id,
    items: body.items,
  });
}
