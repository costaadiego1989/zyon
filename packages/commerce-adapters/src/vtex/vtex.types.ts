export type VtexApiProduct = {
  productId: string;
  productName: string;
  description?: string;
  productUrl?: string;
  brand?: string;
  items?: Array<{
    itemId: string;
    name: string;
    images?: Array<{ imageUrl: string }>;
    sellers?: Array<{
      sellerId: string;
      sellerName: string;
      commertialOffer: {
        price: number;
        listPrice?: number;
        stock: number;
      };
    }>;
  }>;
};

export type VtexOrderForm = {
  id: string;
  orderFormId: string;
  clientProfileData?: {
    email?: string;
  };
  items: Array<{
    id: string;
    productId: string;
    skuId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  totals: Array<{
    id: string;
    name: string;
    value: number;
  }>;
  value: number;
  messages?: Array<{
    code?: string;
    text?: string;
  }>;
  status?: string;
};

export type VtexInventoryResponse = {
  skuId: string;
  balance: Array<{
    warehouseId: string;
    totalQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
};

export type VtexPriceResponse = {
  skuId: string;
  channelId?: string;
  prices: Array<{
    tradePolicyId: string;
    value: number;
    listPrice?: number;
  }>;
};

export type VtexOrderWebhookPayload = {
  orderId?: string;
  orderGroup?: string;
  status?: string;
  timestamp?: string;
  [key: string]: unknown;
};
