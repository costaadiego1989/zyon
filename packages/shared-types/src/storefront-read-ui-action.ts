/** Read-only storefront protocol. Advertisement is not an authorization token. */
export type StorefrontReadUiAction =
  | { tool: "search_products"; args: { query: "*"; categoryId: string; cursor?: string } }
  | { tool: "get_product_details"; args: { productId: string } };

export interface StorefrontReadUiActionCapability {
  version: 1;
  tools: Array<StorefrontReadUiAction["tool"]>;
}

export interface StorefrontReadUiActionRequest {
  ui_action_version: 1;
  ui_action: StorefrontReadUiAction;
}

/** Server-projected display suggestion. Its ID/label never authorize execution. */
export interface StorefrontSuggestedReadAction {
  id: string;
  label: string;
  action: StorefrontReadUiAction;
}

export interface StorefrontSuggestedReadActions {
  version: 1;
  items: StorefrontSuggestedReadAction[];
}

