/** Versioned storefront UI protocol. Advertisement is not an authorization token. */
export type StorefrontReadUiAction =
  | { tool: "search_products"; args: { query: "*"; categoryId: string; cursor?: string } }
  | { tool: "get_product_details"; args: { productId: string } };

/** Question actions are separate from catalog suggestions; only explicit create writes an intake. */
export type StorefrontQuestionUiAction =
  | { tool: "get_product_questions"; args: { productId: string; filter?: "answered" | "unanswered" | "mine" } }
  | { tool: "ask_product_question"; args: { productId: string } }
  | { tool: "create_question"; args: { productId: string; question: string } };
export type StorefrontPublicUiAction = StorefrontReadUiAction | StorefrontQuestionUiAction;

export interface StorefrontReadUiActionCapability {
  version: 1;
  /** The legacy capability field name also advertises explicit question submission. */
  tools: Array<StorefrontPublicUiAction["tool"]>;
}

export interface StorefrontReadUiActionRequest {
  ui_action_version: 1;
  ui_action: StorefrontPublicUiAction;
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

