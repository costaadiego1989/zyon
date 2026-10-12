import { RealtimeVoiceInput, type VoiceInputEvent } from "@zyon/shared-types";
import { randomUUID } from "node:crypto";
import { AiUserRateLimitService } from "../http/ai-user-rate-limit.service.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";

type Event = VoiceInputEvent & { type?: string; item?: { id?: string; type?: string; role?: string; content?: Array<{ type?: string }>; call_id?: string }; response_id?: string; response?: { id?: string; metadata?: Record<string, string> }; session?: { audio?: { input?: { turn_detection?: { create_response?: boolean } } } } };

/** Runs on the server sideband. Only admitted user items may create a response. */
export class RealtimeVoiceTurnGate {
  private readonly items = new Set<string>();
  private readonly responseKeys = new Set<string>();
  private readonly responses = new Map<string, { permit?: string; continuations: number }>();
  private readonly tools = new Map<string, { permit?: string; continuations: number }>();
  private stopped = false;
  private readonly input = new RealtimeVoiceInput();
  private readonly pending: Array<{ permit?: string; continuations: number }> = [];

  constructor(
    private readonly identity: { userId: string; merchantId: string; resourceId: string; origin?: string },
    private readonly limiter: AiUserRateLimitService,
    private readonly capabilities: RealtimeCapabilityService,
    private readonly send: (event: unknown) => void,
    private readonly close: () => Promise<void>,
    private readonly resolveIdentity?: () => Promise<string>,
  ) {}

  async handle(event: Event): Promise<void> {
    if (this.stopped) return;
    if (event.type === "session.updated" && event.session?.audio?.input?.turn_detection?.create_response !== false) {
      return this.stop();
    }
    const speech = this.input.receive(event);
    if (speech && speech.kind !== "speech") {
      this.send({ type: "conversation.item.delete", item_id: speech.itemId });
      return;
    }
    const userItem = (event.type === "conversation.item.added" || event.type === "conversation.item.created") && event.item?.role === "user" && event.item.id;
    if (userItem && event.item?.content?.some(part => part.type === "input_audio")) return;
    if (speech?.kind === "speech" || ((event.type === "conversation.item.added" || event.type === "conversation.item.created") && event.item?.role === "user" && event.item.id)) {
      const itemId = speech?.itemId ?? event.item!.id!;
      if (this.items.has(itemId)) return;
      this.items.add(itemId);
      if (this.items.size > 600) return this.stop();
      try {
        if (this.resolveIdentity) this.identity.userId = await this.resolveIdentity();
        await this.limiter.assertAllowed(this.identity.userId);
      }
      catch (error) {
        const payload = (error as { getResponse?: () => unknown }).getResponse?.() as { code?: string; retry_after_seconds?: number } | undefined;
        this.send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ zyon_voice_error: payload?.code ?? "ai_rate_limit_unavailable", retry_after_seconds: payload?.retry_after_seconds }) }] } });
        return this.stop();
      }
      const permit = this.capabilities.issue({ purpose: "ai-voice-turn", merchantId: this.identity.merchantId, resourceId: this.identity.resourceId, aiUserId: this.identity.userId, origin: this.identity.origin }).token;
      if (permit.length > 512) return this.stop();
      this.createResponse(permit, 0);
      return;
    }
    if (event.type === "response.created" && event.response?.id) {
      const metadata = event.response.metadata;
      const key = metadata?.zyon_response_key;
      if (!key || !this.responseKeys.delete(key)) {
        this.send({ type: "response.cancel", response_id: event.response.id });
        return this.stop();
      }
      this.responses.set(event.response.id, { permit: metadata?.zyon_turn_token, continuations: Number(metadata?.zyon_continuations ?? 0) });
      return;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "function_call" && event.item.call_id && event.response_id) {
      const response = this.responses.get(event.response_id);
      if (response) this.tools.set(event.item.call_id, response);
    }
    if ((event.type === "conversation.item.added" || event.type === "conversation.item.created") && event.item?.type === "function_call_output" && event.item.call_id) {
      const turn = this.tools.get(event.item.call_id);
      if (!turn) return;
      this.tools.delete(event.item.call_id);
      if (turn.continuations >= 3) return this.stop();
      this.createResponse(turn.permit, turn.continuations + 1);
    }
    if ((event.type === "response.done" || event.type === "response.completed") && event.response?.id) {
      this.responses.delete(event.response.id);
      this.flush();
    }
  }

  private createResponse(permit: string | undefined, continuations: number) {
    if (continuations > 0) permit = this.capabilities.issue({ purpose: "ai-voice-turn", merchantId: this.identity.merchantId, resourceId: this.identity.resourceId, aiUserId: this.identity.userId, origin: this.identity.origin }).token;
    if (this.responseKeys.size || this.responses.size || this.tools.size) {
      const turn = { permit, continuations };
      if (continuations) this.pending.unshift(turn); else this.pending.push(turn);
      return;
    }
    const key = randomUUID();
    this.responseKeys.add(key);
    this.send({ type: "response.create", response: { metadata: { zyon_response_key: key, zyon_continuations: String(continuations), ...(permit ? { zyon_turn_token: permit } : {}) } } });
  }

  private flush() {
    if (this.responseKeys.size || this.responses.size || this.tools.size) return;
    const turn = this.pending.shift();
    if (turn) this.createResponse(turn.permit, turn.continuations);
  }

  private async stop() { if (this.stopped) return; this.stopped = true; await this.close(); }
}
