import { dashboardJson } from "../http/client.js";
import type { Experiment, ExperimentForm, ExperimentResults, ExperimentMetrics } from "../../pages/useExperimentsPage.js";

const PREFIX = "/dashboard/experiments";

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
      return dashboardJson<Experiment>(base, PREFIX, { method: "POST", jsonBody: payload }, f);
    },

    async updateExperiment(experimentId: string, payload: Partial<ExperimentForm>): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}`,
        { method: "PUT", jsonBody: payload },
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
      return dashboardJson<ExperimentResults>(
        base,
        `${PREFIX}/${encodeURIComponent(experimentId)}/results`,
        { method: "GET" },
        f
      );
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
