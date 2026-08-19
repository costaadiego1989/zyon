import type { PromptExperimentSnapshot } from '../../../../experiments/domain/entities/prompt-experiment.entity.js';
import type { ExperimentResultsOutput } from '../../../../experiments/application/use-cases/get-experiment-results.use-case.js';

export class ExperimentEntityMapper {
  static toExperimentSummaryResponse(snapshot: PromptExperimentSnapshot) {
    return {
      id: snapshot.id,
      merchant_id: snapshot.merchant_id,
      name: snapshot.name,
      description: snapshot.description,
      status: snapshot.status,
      variants_count: snapshot.variants.length,
      started_at: snapshot.started_at,
      completed_at: snapshot.completed_at,
      winner_variant_id: snapshot.winner_variant_id,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  static toExperimentDetailResponse(snapshot: PromptExperimentSnapshot) {
    return {
      id: snapshot.id,
      merchant_id: snapshot.merchant_id,
      name: snapshot.name,
      description: snapshot.description,
      status: snapshot.status,
      variants: snapshot.variants.map((v) => ({
        id: v.id,
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
        created_at: v.created_at,
        updated_at: v.updated_at,
      })),
      started_at: snapshot.started_at,
      completed_at: snapshot.completed_at,
      winner_variant_id: snapshot.winner_variant_id,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  static toExperimentResultsResponse(results: ExperimentResultsOutput) {
    return {
      experiment_id: results.experiment_id,
      status: results.status,
      started_at: results.started_at,
      completed_at: results.completed_at,
      winner_variant_id: results.winner_variant_id,
      variants: results.variants.map((v) => ({
        variant_id: v.variant_id,
        variant_name: v.variant_name,
        is_control: v.is_control,
        sample_size: v.sample_size,
        conversions: v.conversions,
        conversion_rate: v.conversion_rate,
        avg_revenue: v.avg_revenue,
        total_revenue: v.total_revenue,
        funnel: v.funnel ?? null,
      })),
    };
  }
}
