import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  EXPERIMENT_REPOSITORY_PORT,
  type ExperimentRepositoryPort,
} from "../../domain/ports/experiment-repository.port.js";

export interface VariantMetrics {
  variant_id: string;
  variant_name: string;
  is_control: boolean;
  sample_size: number;
  conversions: number;
  conversion_rate: number;
  avg_revenue: number;
  total_revenue: number;
  funnel?: {
    conversations_started: number;
    carts_viewed: number;
    cart_items_added: number;
    checkouts_started: number;
    checkouts_completed: number;
    avg_time_to_cart: number;
    avg_time_to_checkout: number;
    avg_time_to_conversion: number;
  };
}

export interface ExperimentResultsOutput {
  experiment_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  variants: VariantMetrics[];
  winner_variant_id: string | null;
}

@Injectable()
export class GetExperimentResultsUseCase {
  private readonly logger = new Logger(GetExperimentResultsUseCase.name);

  constructor(
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly repository: ExperimentRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(experimentId: string, merchantId: string): Promise<ExperimentResultsOutput | null> {
    const experiment = await this.repository.findById(experimentId, merchantId);
    if (!experiment) {
      return null;
    }

    // Fetch actual metrics from prompt_variant_results
    const variantIds = experiment.variants.map((v) => v.id);
    const results = await (this.prisma as any).promptVariantResult.findMany({
      where: { variantId: { in: variantIds } },
    });

    // Group results by variantId
    const grouped = new Map<string, typeof results>();
    for (const r of results) {
      const arr = grouped.get(r.variantId) ?? [];
      arr.push(r);
      grouped.set(r.variantId, arr);
    }

    const variants = experiment.variants.map((v) => {
      const varResults = grouped.get(v.id) ?? [];
      const sampleSize = varResults.length;
      const conversions = varResults.filter((r: any) => r.converted).length;
      const totalRevenue = varResults.reduce((sum: number, r: any) => sum + (Number(r.revenue) || 0), 0);

      // Funnel metrics
      const conversationsStarted = varResults.filter((r: any) => r.conversationStarted).length;
      const cartsViewed = varResults.filter((r: any) => r.cartViewed).length;
      const cartItemsAdded = varResults.reduce((sum: number, r: any) => sum + (r.cartItemsAdded ?? 0), 0);
      const checkoutsStarted = varResults.filter((r: any) => r.checkoutStarted).length;
      const checkoutsCompleted = varResults.filter((r: any) => r.checkoutCompleted).length;

      const timesToCart = varResults.filter((r: any) => r.timeToCart != null).map((r: any) => r.timeToCart);
      const timesToCheckout = varResults.filter((r: any) => r.timeToCheckout != null).map((r: any) => r.timeToCheckout);
      const timesToConversion = varResults.filter((r: any) => r.timeToConversion != null).map((r: any) => r.timeToConversion);

      const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

      return {
        variant_id: v.id,
        variant_name: v.name,
        is_control: v.is_control,
        sample_size: sampleSize,
        conversions,
        conversion_rate: sampleSize > 0 ? Math.round((conversions / sampleSize) * 10000) / 100 : 0,
        avg_revenue: sampleSize > 0 ? Math.round((totalRevenue / sampleSize) * 100) / 100 : 0,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        funnel: {
          conversations_started: conversationsStarted,
          carts_viewed: cartsViewed,
          cart_items_added: cartItemsAdded,
          checkouts_started: checkoutsStarted,
          checkouts_completed: checkoutsCompleted,
          avg_time_to_cart: avg(timesToCart),
          avg_time_to_checkout: avg(timesToCheckout),
          avg_time_to_conversion: avg(timesToConversion),
        },
      };
    });

    return {
      experiment_id: experiment.id,
      status: experiment.status,
      started_at: experiment.started_at,
      completed_at: experiment.completed_at,
      variants,
      winner_variant_id: experiment.winner_variant_id,
    };
  }
}
