import { RealtimeVoiceInput, type VoiceInputEvent } from "@zyon/shared-types";
import { randomUUID } from "node:crypto";
import { AiUserRateLimitService } from "../http/ai-user-rate-limit.service.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";
import { z } from "zod";

type Event = VoiceInputEvent & { type?: string; item?: { id?: string; type?: string; role?: string; content?: Array<{ type?: string; text?: string }>; call_id?: string }; response_id?: string; response?: { id?: string; metadata?: Record<string, string> }; session?: { audio?: { input?: { turn_detection?: { create_response?: boolean } } } } };
export type VoiceScopeCheck = (input: { userMessage: string; history: Array<{ role: "user" | "assistant"; content: string }> }) => Promise<unknown>;
const scopeDecision = z.discriminatedUnion("allowed", [z.strictObject({ allowed: z.literal(true) }),
  z.strictObject({ allowed: z.literal(false), reason: z.enum(["out_of_scope", "scope_unclear"]), message: z.string().trim().min(1).max(800) })]);
const scopeText = z.string().trim().min(1).max(4000);
const SCOPE_CLARIFICATION = "Posso ajudar com compras e atendimento desta loja. Você pode reformular seu pedido?";
type AdmittedResponse = { permit?: string; continuations: number; refusal?: string };

/** Runs on the server sideband. Only admitted user items may create a response. */
export class RealtimeVoiceTurnGate {
  private readonly items = new Set<string>();
  private readonly responseKeys = new Map<string, AdmittedResponse>();
  private readonly responses = new Map<string, AdmittedResponse>();
  private readonly tools = new Map<string, { permit?: string; continuations: number }>();
  private stopped = false;
  private readonly input = new RealtimeVoiceInput();
  private readonly pending: AdmittedResponse[] = [];
  private readonly history: Array<{ role: "user" | "assistant"; content: string }> = [];

  constructor(
    private readonly identity: { userId: string; merchantId: string; resourceId: string; origin?: string },
    private readonly limiter: AiUserRateLimitService,
    private readonly capabilities: RealtimeCapabilityService,
    private readonly send: (event: unknown) => void,
    private readonly close: () => Promise<void>,
    private readonly resolveIdentity?: () => Promise<string>,
    private readonly checkScope?: VoiceScopeCheck,
  ) {}

  async handle(event: Event): Promise<void> {
    if (this.stopped) return;
    if (event.type === "response.output_audio_transcript.done" && event.response_id
      && this.responses.get(event.response_id)?.permit && typeof event.transcript === "string") {
      const text = event.transcript.trim();
      if (text && text.length <= 8000) this.remember("assistant", text);
      return;
    }
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
    if (speech?.kind === "speech" || (userItem && !speech)) {
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
      if (this.checkScope) {
        const text = scopeText.safeParse(speech?.kind === "speech" ? event.transcript
          : event.item?.content?.filter(part => part.type === "input_text").map(part => part.text ?? "").join("\n"));
        let parsed: ReturnType<typeof scopeDecision.safeParse> | undefined;
        if (text.success) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const deadline = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 10_000); });
            parsed = scopeDecision.safeParse(await Promise.race([
              this.checkScope({ userMessage: text.data, history: structuredClone(this.history) }), deadline,
            ]));
          }
          catch { /* Unknown is not permission; no retry or provider fallback. */ }
          finally { clearTimeout(timer); }
        }
        if (this.stopped) return;
        if (!parsed?.success || !parsed.data.allowed) {
          const message = parsed?.success && !parsed.data.allowed ? parsed.data.message : SCOPE_CLARIFICATION;
          // Do not leave rejected instructions in the context of a later allowed turn.
          this.send({ type: "conversation.item.delete", item_id: itemId });
          this.createResponse(undefined, 0, message);
          return;
        }
        if (text.success) this.remember("user", text.data);
      }
      const permit = this.capabilities.issue({ purpose: "ai-voice-turn", merchantId: this.identity.merchantId, resourceId: this.identity.resourceId, aiUserId: this.identity.userId, origin: this.identity.origin }).token;
      if (permit.length > 512) return this.stop();
      this.createResponse(permit, 0);
      return;
    }
    if (event.type === "response.created" && event.response?.id) {
      const metadata = event.response.metadata;
      const key = metadata?.zyon_response_key;
      const admitted = key ? this.responseKeys.get(key) : undefined;
      if (!key || !admitted) {
        this.send({ type: "response.cancel", response_id: event.response.id });
        return this.stop();
      }
      this.responseKeys.delete(key);
      this.responses.set(event.response.id, admitted);
      return;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "function_call" && event.item.call_id && event.response_id) {
      const response = this.responses.get(event.response_id);
      if (response?.refusal) {
        this.send({ type: "response.cancel", response_id: event.response_id });
        return this.stop();
      }
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

  private remember(role: "user" | "assistant", content: string) {
    this.history.push({ role, content });
    if (this.history.length > 6) this.history.splice(0, this.history.length - 6);
  }

  private createResponse(permit: string | undefined, continuations: number, refusal?: string) {
    if (this.responseKeys.size || this.responses.size || this.tools.size) {
      const turn = { permit, continuations, ...(refusal ? { refusal } : {}) };
      if (continuations) this.pending.unshift(turn); else this.pending.push(turn);
      return;
    }
    if (continuations > 0) permit = this.capabilities.issue({ purpose: "ai-voice-turn", merchantId: this.identity.merchantId, resourceId: this.identity.resourceId, aiUserId: this.identity.userId, origin: this.identity.origin }).token;
    const key = randomUUID();
    this.responseKeys.set(key, { permit, continuations, ...(refusal ? { refusal } : {}) });
    this.send({ type: "response.create", response: {
      ...(refusal ? { conversation: "none", input: [], tools: [], tool_choice: "none", max_output_tokens: 256,
        instructions: JSON.stringify({ role: "Leitor de uma mensagem fixa da loja, não assistente geral.",
          task: "Leia somente message em pt-BR, sem acrescentar conteúdo, responder perguntas ou usar ferramentas.", message: refusal }) } : {}),
      metadata: { zyon_response_key: key, zyon_continuations: String(continuations), ...(permit ? { zyon_turn_token: permit } : {}) },
    } });
  }

  private flush() {
    if (this.responseKeys.size || this.responses.size || this.tools.size) return;
    const turn = this.pending.shift();
    if (turn) this.createResponse(turn.permit, turn.continuations, turn.refusal);
  }

  private async stop() { if (this.stopped) return; this.stopped = true; await this.close(); }
}
