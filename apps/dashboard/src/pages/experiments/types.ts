export interface Variant {
  id: string;
  name: string;
  description?: string;
  is_control?: boolean;
  weight?: number;
}

export interface Experiment {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  variants: Variant[];
  control_variant_id: string;
  winner_variant_id?: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  sample_size: number;
}

export interface ExperimentMetrics {
  experiment_id: string;
  variant_id: string;
  conversions: number;
  total_visitors: number;
  conversion_rate: number;
  avg_order_value?: number;
  revenue?: number;
}

export interface ExperimentResults {
  experiment_id: string;
  created_at: string;
  winner_variant_id?: string;
  confidence_level: number; // 0-100
  metrics: ExperimentMetrics[];
}

export interface ExperimentForm {
  name: string;
  description?: string;
  variants: Array<{ name: string; description?: string; is_control?: boolean; weight?: number }>;
  sample_size: number;
}
