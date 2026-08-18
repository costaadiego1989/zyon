import { dashboardJson } from "../http/client.js";
import type { Experiment, ExperimentForm, ExperimentResults, ExperimentMetrics } from "../../pages/useExperimentsPage.js";

export function experimentsEndpoints(base: string, f: typeof fetch) {
  return {
    /**
     * GET /experiments
     * Fetch all experiments for merchant
     */
    async getExperiments(): Promise<Experiment[]> {
      return dashboardJson<Experiment[]>(base, "/experiments", { method: "GET" }, f);
    },

    /**
     * GET /experiments/:experimentId
     * Fetch single experiment details
     */
    async getExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}`,
        { method: "GET" },
        f
      );
    },

    /**
     * POST /experiments
     * Create new experiment (draft status)
     */
    async createExperiment(payload: ExperimentForm): Promise<Experiment> {
      return dashboardJson<Experiment>(base, "/experiments", { method: "POST", jsonBody: payload }, f);
    },

    /**
     * PATCH /experiments/:experimentId
     * Update experiment (name, description, variants)
     */
    async updateExperiment(
      experimentId: string,
      payload: Partial<ExperimentForm>
    ): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}`,
        { method: "PATCH", jsonBody: payload },
        f
      );
    },

    /**
     * POST /experiments/:experimentId/start
     * Start running experiment (draft -> running)
     */
    async startExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}/start`,
        { method: "POST" },
        f
      );
    },

    /**
     * POST /experiments/:experimentId/stop
     * Pause running experiment (running -> paused)
     */
    async stopExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}/stop`,
        { method: "POST" },
        f
      );
    },

    /**
     * POST /experiments/:experimentId/archive
     * Archive experiment (any status -> archived)
     */
    async archiveExperiment(experimentId: string): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}/archive`,
        { method: "POST" },
        f
      );
    },

    /**
     * GET /experiments/:experimentId/results
     * Fetch experiment results and statistical significance
     */
    async getExperimentResults(experimentId: string): Promise<ExperimentResults> {
      return dashboardJson<ExperimentResults>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}/results`,
        { method: "GET" },
        f
      );
    },

    /**
     * POST /experiments/:experimentId/promote/:variantId
     * Promote variant to winner (winner -> production)
     * Requires confidence >= 95%
     */
    async promoteExperimentVariant(
      experimentId: string,
      variantId: string
    ): Promise<Experiment> {
      return dashboardJson<Experiment>(
        base,
        `/experiments/${encodeURIComponent(experimentId)}/promote/${encodeURIComponent(variantId)}`,
        { method: "POST" },
        f
      );
    },
  };
}
