import { dashboardJson } from "../http/client.js";
import type { Experiment, ExperimentForm, ExperimentResults, ExperimentMetrics } from "../../pages/useExperimentsPage.js";

const PREFIX = "/dashboard/experiments";

/** Distribute 100% evenly — last variant absorbs remainder so sum is always 100 */
function distributeWeights(count: number): number[] {
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function experimentsEndpoints(base: string, f: typeof fetch) {
  return {
    async getExperiments(): Promise<Experiment[]> {
      const res = await dashboardJson<{ data: Experiment[] } | Experiment[]>(base, PREFIX, { method: "GET" }, f);
      return Array.isArray(res) ? res : res.data;
    },

    async getExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}`,
        { method: "GET" },
        f
      );
    },

    async createExperiment(payload: ExperimentForm): Promise<Experiment> {
      const weights = distributeWeights(payload.variants.length);
      const apiPayload = {
        name: payload.name,
        description: payload.description,
        variants: payload.variants.map((v, idx) => ({
          name: v.name,
          system_prompt: v.description || `Variante ${v.name}`,
          weight: weights[idx],
          is_control: v.is_control ?? idx === 0,
        })),
      };
      return dashboardJson<Experiment>(base, PREFIX, { method: "POST", jsonBody: apiPayload }, f);
    },

    async updateExperiment(experimentId: string, payload: Partial<ExperimentForm>): Promise<Experiment> {
      const apiPayload: Record<string, unknown> = {};
      if (payload.name) apiPayload.name = payload.name;
      if (payload.description !== undefined) apiPayload.description = payload.description;
      if (payload.variants) {
        const weights = distributeWeights(payload.variants.length);
        apiPayload.variants = payload.variants.map((v, idx) => ({
          name: v.name,
          system_prompt: v.description || `Variante ${v.name}`,
          weight: weights[idx],
          is_control: v.is_control ?? idx === 0,
        }));
      }
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}`,
        { method: "PUT", jsonBody: apiPayload },
        f
      );
    },

    async startExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/start`,
        { method: "POST" },
        f
      );
    },

    async stopExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/stop`,
        { method: "POST" },
        f
      );
    },

    async archiveExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/archive`,
        { method: "POST" },
        f
      );
    },

    async getExperimentResults(experimentId: string): Promise<ExperimentResults> {
      const raw = await dashboardJson<any>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/results`,
        { method: "GET" },
        f
      );
      // Map API response shape to dashboard ExperimentResults type
      return {
        experiment_id: raw.experiment_id ?? experimentId,
        created_at: raw.started_at ?? raw.created_at ?? "",
        winner_variant_id: raw.winner_variant_id,
        confidence_level: raw.confidence_level ?? raw.significance?.confidence ?? 0,
        metrics: (raw.variant_results ?? raw.metrics ?? []).map((v: any) => ({
          experiment_id: raw.experiment_id ?? experimentId,
          variant_id: v.variant_id,
          conversions: v.conversions ?? 0,
          total_visitors: v.sessions ?? v.total_visitors ?? 0,
          conversion_rate: v.conversion_rate ?? 0,
          avg_order_value: v.avg_order_value ?? 0,
          revenue: v.revenue ?? 0,
        })),
      };
    },

    async promoteExperimentVariant(experimentId: string, variantId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/promote`,
        { method: "POST", jsonBody: { variant_id: variantId } },
        f
      );
    },
  };
}
