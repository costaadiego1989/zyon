/**
 * Backward-compat re-export — use `./experiments/hooks/` directly in new code.
 */
export { useExperimentsPage, validateExperimentForm } from "./experiments/hooks/index.js";
export type { Experiment, ExperimentForm, ExperimentResults, ExperimentMetrics, Variant } from "./experiments/types.js";
