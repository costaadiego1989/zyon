import { MetaAdsError, type MetaAccess } from "../domain/types.js";

type Json = Record<string, unknown>;
interface Tool { name: string; inputSchema?: { required?: string[]; properties?: Json; additionalProperties?: boolean }; }
const reads = new Set(["ads_get_ad_accounts", "ads_get_ad_account_pages", "ads_get_user_pages", "ads_catalog_list_catalogs", "ads_get_datasets", "ads_get_field_context", "ads_get_ad_entities", "ads_get_creatives", "ads_get_opportunity_score", "ads_account_get_activity_logs", "ads_insights_advertiser_context", "ads_insights_anomaly_signal", "ads_insights_auction_ranking_benchmarks", "ads_insights_industry_benchmark", "ads_insights_performance_trend", "ads_insights_performance_vs_peers", "ads_get_errors", "ads_get_dataset_details", "ads_get_dataset_quality", "ads_get_dataset_stats", "ads_catalog_get_diagnostics", "ads_catalog_get_dynamic_ads_health"]);
const writes = new Set(["ads_create_campaign", "ads_create_ad_set", "ads_create_creative", "ads_create_ad", "ads_update_entity", "ads_activate_entity"]);
export class McpFailure extends MetaAdsError {
  constructor(code: string, public readonly uncertain: boolean, status = 502) { super(code, status); }
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new McpFailure("meta_response_invalid", false);
  return value as Json;
}
export function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new McpFailure("meta_response_invalid", false); }
}
export function entityRows(value: unknown): Json[] {
  const result = decoded(value);
  if (Array.isArray(result)) return result.map(object);
  if (result && typeof result === "object" && Array.isArray((result as Json).data)) return ((result as Json).data as unknown[]).map(object);
  throw new McpFailure("meta_response_invalid", false);
}

/** One operation, one scoped MCP session. No retries of submitted writes. */
export class MetaMcpSession {
  private sequence = 0;
  private sessionId: string | null = null;
  private protocol = "2025-03-26";
  private tools = new Map<string, Tool>();
  private continuations = 0;
  constructor(private readonly access: MetaAccess, private readonly request: typeof fetch, private readonly job: string, private readonly writeEnabled: boolean, private readonly scheduled = false) {
    if (!/^[A-Za-z0-9]{20}$/.test(access.clientConversationId)) throw new MetaAdsError("meta_conversation_invalid");
    if (!access.accessToken) throw new MetaAdsError("meta_credential_missing", 403);
  }
  async start(): Promise<void> {
    const initialized = object(await this.rpc("initialize", { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: "zyon-meta-ads-agent", version: "1" } }));
    if (typeof initialized.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(initialized.protocolVersion)) throw new McpFailure("meta_protocol_invalid", false);
    this.protocol = initialized.protocolVersion;
    await this.rpc("notifications/initialized", {}, false, true);
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = object(await this.rpc("tools/list", cursor ? { cursor } : {}));
      if (!Array.isArray(result.tools)) throw new McpFailure("meta_response_invalid", false);
      for (const value of result.tools) { const tool = value as Tool; if (typeof tool.name === "string") this.tools.set(tool.name, tool); }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (!cursor) return;
    }
    throw new McpFailure("meta_pagination_limit", false);
  }
  has(name: string): boolean { return this.tools.has(name); }
  require(names: string[]): void {
    if (names.some(n => !this.has(n))) throw new McpFailure("meta_capability_unavailable", false, 503);
  }
  async call(name: string, args: Json, write = false): Promise<Json> {
    if (!(write ? writes : reads).has(name) || (write && !this.writeEnabled)) throw new McpFailure("meta_capability_unavailable", false, 503);
    this.require([name]);
    if (args.ad_account_id !== undefined && String(args.ad_account_id).replace(/^act_/, "") !== this.access.accountId?.replace(/^act_/, "")) throw new MetaAdsError("meta_asset_forbidden", 403);
    const parameters = { ...args, client_conversation_id: this.access.clientConversationId, advertiser_job: this.job, scheduled_task_run: this.scheduled };
    const schema = this.tools.get(name)?.inputSchema;
    if (schema?.required?.some(key => !(key in parameters)) || (schema?.additionalProperties === false && Object.keys(parameters).some(key => !Object.hasOwn(schema.properties ?? {}, key)))) throw new McpFailure("meta_tool_contract_changed", false, 503);
    if (write) await this.access.assertWriteAuthorized?.();
    const envelope = object(await this.rpc("tools/call", { name, arguments: parameters }, write));
    if (envelope.isError) throw new McpFailure("meta_tool_failed", write);
    let data: Json;
    if (envelope.structuredContent) data = object(envelope.structuredContent);
    else {
      const text = Array.isArray(envelope.content) ? envelope.content.find((v: Json) => v.type === "text")?.text : null;
      data = object(decoded(text));
    }
    if (data.error_category || data.error || data.success === false) throw new McpFailure(data.error_category === "PERMISSION" ? "meta_permission_denied" : "meta_tool_failed", write && !["PERMISSION", "VALIDATION", "NOT_FOUND"].includes(String(data.error_category)));
    if (typeof data.client_conversation_id === "string" && /^[A-Za-z0-9]{20}$/.test(data.client_conversation_id)) this.access.clientConversationId = data.client_conversation_id;
    const actions = (data.next_actions as { actions?: Json[] } | undefined)?.actions ?? [];
    // Save the queue before each nested read, then resume it in step order.
    for (const action of [...actions].sort((a, b) => Number(a.step) - Number(b.step))) {
      if (action.strength !== "required" || action.read_only !== true || action.requires_user_confirmation !== false) continue;
      if (++this.continuations > 32) throw new McpFailure("meta_continuation_limit", false);
      await this.call(String(action.tool), object(decoded(action.suggested_args)));
    }
    return data;
  }
  async fields(names: string[]): Promise<void> {
    const context = await this.call("ads_get_field_context", { field_names: names });
    if (!Array.isArray(context.fields) || !Array.isArray(context.unknown_fields) || context.unknown_fields.length || names.some(name => !(context.fields as Json[]).some(field => field.name === name || (Array.isArray(field.aliases) && field.aliases.includes(name))))) throw new McpFailure("meta_fields_unavailable", false, 503);
  }
  private async rpc(method: string, params: Json, write = false, notification = false): Promise<unknown> {
    const id = ++this.sequence;
    try {
      const response = await this.request("https://mcp.facebook.com/ads", { method: "POST", redirect: "error", headers: {
        Authorization: `Bearer ${this.access.accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": this.protocol,
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      }, body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }), signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new McpFailure(response.status === 401 || response.status === 403 ? "meta_permission_denied" : "meta_transport_failed", write && response.status !== 401 && response.status !== 403);
      if (method === "initialize") this.sessionId = response.headers.get("Mcp-Session-Id");
      if (notification && response.status === 202) return {};
      const body = await response.text();
      if (body.length > 5_000_000) throw new McpFailure("meta_response_too_large", write);
      const messages: unknown[] = response.headers.get("Content-Type")?.includes("text/event-stream")
        ? body.split(/\r?\n\r?\n/).filter(event => event.includes("data:")).map(event => decoded(event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")))
        : [decoded(body)];
      const message = messages.flat().find(value => value && typeof value === "object" && (value as Json).id === id) as Json | undefined;
      if (!message || message.error || !("result" in message)) throw new McpFailure("meta_rpc_failed", write);
      return message.result;
    } catch (error) {
      if (error instanceof McpFailure) throw error;
      throw new McpFailure("meta_transport_failed", write);
    }
  }
}
