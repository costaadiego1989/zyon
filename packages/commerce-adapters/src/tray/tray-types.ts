export interface TrayCommerceCredentials {
  merchantId: string;
  provider: "tray";
  apiAddress: string; // e.g., https://store.com.br/web_api
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number; // unix timestamp
  consumerKey: string; // app credential for refresh
  consumerSecret: string; // app credential for refresh
}

export type TrayFetchFn = typeof fetch;

// API response types
export type TrayProduct = {
  id: number;
  name: string;
  description?: string;
  price: string; // decimal string
  cost: string; // decimal string
  quantity: number;
  image: string; // URL
  url: string; // product permalink
  category?: { id: number; name: string };
};

export type TrayOrder = {
  id: number;
  status: string; // e.g., "open", "invoiced", "shipped", "cancelled"
  number: string;
  total: string;
  currency: string;
  items: Array<{
    id: number;
    name: string;
    sku?: string;
    quantity: number;
    price: string;
  }>;
  customer?: {
    id: number;
    email: string;
    name: string;
  };
};

export type TrayListResponse<T> = {
  result: T[];
  paging?: {
    current: number;
    next?: number;
  };
};
