/** Bounded metadata only. No buyer, merchant, prompt, response or exception payload. */
export const STOREFRONT_USE_CASE_OBSERVATION = Symbol("StorefrontUseCaseObservation");
export const storefrontObservationBoundaries = ["input", "context", "output", "response", "buyer_message", "agent_message", "fallback", "generation"] as const;
export type StorefrontObservationBoundary = typeof storefrontObservationBoundaries[number];
export type StorefrontUseCaseObservationReason = "invalid_input" | "invalid_context" | "invalid_output" | "safety_rejected" | "exception";
export interface StorefrontUseCaseObservation {
  turn<T>(execute: () => Promise<T>): Promise<T>;
  operation<T>(stage: "validation" | "persistence" | "generation", boundary: StorefrontObservationBoundary, execute: () => Promise<T>): Promise<T>;
  decision(boundary: StorefrontObservationBoundary, outcome: "rejected" | "fallback", reason: StorefrontUseCaseObservationReason): void;
}
export const NOOP_STOREFRONT_USE_CASE_OBSERVATION: StorefrontUseCaseObservation = {
  turn: execute => execute(), operation: (_stage, _boundary, execute) => execute(), decision: () => {},
};

