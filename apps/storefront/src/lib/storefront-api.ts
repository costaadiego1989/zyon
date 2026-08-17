const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

export async function postStorefrontBudgetRequest(body: {
  merchant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items: Array<{ variantId: string; productName: string; quantity: number; price: number }>;
  total: number;
  note?: string;
}) {
  const res = await fetch(`${API_BASE}/storefront/budget-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Budget request failed: ${res.status} ${errorText}`);
  }

  return res.json();
}
