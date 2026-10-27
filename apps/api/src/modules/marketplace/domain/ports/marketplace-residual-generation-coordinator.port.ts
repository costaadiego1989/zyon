/** Native GET evidence and local accounting, including generations with no POST. */
export interface MarketplaceResidualGenerationCoordinator {
  certifyPlan(hostMerchantId: string, residualPlanId: string, now?: Date): Promise<void>;
  recover(limit: number): Promise<{ attempted: number; reconciled: number; failed: number }>;
}
