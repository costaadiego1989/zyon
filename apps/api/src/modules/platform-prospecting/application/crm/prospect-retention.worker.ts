import type { ProspectPrivacyPort } from "../../domain/prospecting.ports.js";
export class ProspectRetentionWorker {
  constructor(private readonly privacy: ProspectPrivacyPort) {}
  run(now = new Date()) { if (!Number.isFinite(now.getTime())) throw new Error("invalid_retention_time"); return this.privacy.retain(now, 100); }
}
