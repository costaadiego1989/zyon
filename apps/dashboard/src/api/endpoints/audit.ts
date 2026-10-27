import { dashboardJson } from "../http/client.js";
import type { AuditEvent, CursorPage } from "../types.js";

export interface AuditEventFilters {
  limit?: number;
  cursor?: string;
  action?: string;
  resource_type?: string;
  actor_id?: string;
  since?: string;
  until?: string;
}

export function auditEndpoints(base: string, f: typeof fetch) {
  return {
    async getAuditEvents(filters?: AuditEventFilters): Promise<CursorPage<AuditEvent>> {
      const params = new URLSearchParams();
      if (filters?.limit) params.set("limit", String(filters.limit));
      if (filters?.cursor) params.set("cursor", filters.cursor);
      if (filters?.action) params.set("action", filters.action);
      if (filters?.resource_type) params.set("resource_type", filters.resource_type);
      if (filters?.actor_id) params.set("actor_id", filters.actor_id);
      if (filters?.since) params.set("since", filters.since);
      if (filters?.until) params.set("until", filters.until);
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<CursorPage<AuditEvent>>(
        base,
        `/audit-events${query}`,
        { method: "GET" },
        f,
      );
    },
  };
}
