import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantProfile, Product } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { canManageServiceAttendance } from "../../../lib/auth/permissions.js";
import { publishedServices } from "./service-category-form.js";

export function useServiceCategoriesPanelData(me: MerchantProfile | null) {
  const api = useApi(), allowed = canManageServiceAttendance(me);
  const context = useMemo(() => allowed && me ? { api, merchantId: me.id, userId: me.user_id } : null, [api, allowed, me?.id, me?.user_id]);
  const current = useRef(context); current.current = context;
  const mounted = useRef(true), sequence = useRef(0), reading = useRef<{ context: typeof context } | null>(null);
  const [state, setState] = useState<{ context: typeof context; status: "idle" | "loading" | "ready" | "error"; items: Product[]; nextCursor?: string; error?: string }>({ context: null, status: "idle", items: [] });
  const visible = state.context === context ? state : { context, status: "idle" as const, items: [] as Product[], nextCursor: undefined, error: undefined };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);

  async function read(cursor?: string) {
    const scope = context;
    if (!scope || !mounted.current || current.current !== scope || reading.current?.context === scope) return false;
    const token = { context: scope }, generation = ++sequence.current; reading.current = token;
    const previous = visible.items;
    setState({ context: scope, status: "loading", items: previous });
    try {
      const result = await scope.api.listProducts(scope.merchantId, { status: "active", limit: 25, ...(cursor ? { cursor } : {}) });
      if (!mounted.current || current.current !== scope || sequence.current !== generation) return false;
      if (cursor && result.nextCursor === cursor) throw new Error("catalog_cursor_did_not_advance");
      const seen = new Set<string>();
      const items = [...(cursor ? previous : []), ...publishedServices(result.products, scope.merchantId)].filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
      setState({ context: scope, status: "ready", items, nextCursor: result.nextCursor });
      return true;
    } catch {
      if (mounted.current && current.current === scope && sequence.current === generation) setState({ context: scope, status: "error", items: previous, error: "Não foi possível consultar os serviços. Consulte novamente para conferir os vínculos atuais." });
      return false;
    } finally { if (reading.current === token) reading.current = null; }
  }
  return { allowed, ...visible, read };
}
