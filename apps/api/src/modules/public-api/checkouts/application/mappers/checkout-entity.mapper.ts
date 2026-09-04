import type {
  StartCheckoutResponse,
  TrackEventResponse,
  CheckoutSession,
  ShippingEvaluateResponse,
  ApplyOfferResponse,
  CompleteOrderResponse,
  UpdateCartResponse,
} from '@zyon/shared-types';

/**
 * Pure mapper functions: domain → v1 API response shape.
 * No side effects, no business logic.
 *
 * These transform internal domain results into the public API contract.
 * Internal fields (debug, internal flags, etc.) are excluded here.
 */
export class CheckoutEntityMapper {
  /**
   * StartCheckoutResponse → v1 response
   */
  static toStartCheckoutResponse(result: StartCheckoutResponse) {
    return {
      session_id: result.session_id,
      conversation_id: result.conversation_id,
      global_user_id: result.global_user_id,
      agent_enabled: result.agent_enabled,
      initial_mode: result.initial_mode,
      tracking_token: result.tracking_token,
      experience: result.experience,
      turns: result.turns ?? [],
    };
  }

  /**
   * CheckoutSession → v1 session response
   */
  static toCheckoutSessionResponse(session: CheckoutSession) {
    return {
      session_id: session.sessionId,
      merchant_id: session.merchantId,
      conversation_id: session.conversationId,
      global_user_id: session.globalUserId,
      cart: session.cart ?? [],
      customer: session.customer ?? null,
      shipping: session.shipping ?? null,
      abandonment_score: session.abandonmentScore ?? 0,
      agent_enabled: session.triggerAgent ?? false,
      created_at: session.createdAt ?? new Date().toISOString(),
    };
  }

  /**
   * TrackEventResponse → v1 response
   */
  static toTrackEventResponse(result: TrackEventResponse) {
    return {
      received: result.received,
      abandonment_score: result.abandonment_score,
      trigger_agent: result.trigger_agent,
      progressive_offer: result.progressive_offer ?? null,
    };
  }

  /**
   * Chat message response → v1 response
   * ChatMessageUseCase returns ChatTurn-like objects
   */
  static toChatMessageResponse(result: any) {
    return {
      role: result.role ?? 'assistant',
      content: result.text ?? result.content ?? '',
      conversation_id: result.conversation_id ?? result.conversationId,
      session_id: result.session_id ?? result.sessionId,
      experience: result.experience ?? null,
      offers: result.offers ?? [],
      turns: result.turns ?? [],
    };
  }

  /**
   * ShippingEvaluateResponse → v1 response
   */
  static toShippingEvaluateResponse(result: ShippingEvaluateResponse) {
    return {
      approved: result.approved,
      action: result.action,
      reason: result.reason,
      shipping_subsidy: result.shipping_subsidy,
      margin_after_offer: result.margin_after_offer,
      message: result.message,
      offer: result.offer ?? null,
    };
  }

  /**
   * ApplyOfferResponse → v1 response
   */
  static toApplyOfferResponse(result: ApplyOfferResponse) {
    return {
      success: result.success,
      discount_code: result.discount_code ?? null,
      apply_url: result.apply_url ?? null,
      new_total: result.new_total ?? null,
      expires_at: result.expires_at ?? null,
      reason: result.reason ?? null,
    };
  }

  /**
   * CompleteOrderResponse → v1 response
   */
  static toCompleteOrderResponse(result: CompleteOrderResponse) {
    return {
      recorded: result.recorded,
      idempotent: result.idempotent,
      event_type: result.event_type,
    };
  }

  /**
   * UpdateCartResponse → v1 response
   */
  static toUpdateCartResponse(result: UpdateCartResponse) {
    return {
      session_id: result.session_id,
      experience: result.experience,
    };
  }
}
