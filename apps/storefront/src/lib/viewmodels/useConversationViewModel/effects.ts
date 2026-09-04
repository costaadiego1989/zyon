"use client";

import { useEffect, useRef } from "react";
import { setupIdleTrigger, setupExitIntentTrigger, type TriggerName } from "@/lib/triggers";
import { trackPurchase } from "@/lib/analytics";

export function useNudgeTriggers(
  merchantId: string | undefined,
  conversationIdRef: { current: string | null },
  fireNudge: (t: TriggerName) => void,
) {
  const fireNudgeRef = useRef(fireNudge);
  fireNudgeRef.current = fireNudge;

  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
    const cfg = {
      idleSeconds: 30,
      apiBaseUrl: API_BASE,
      merchantId,
      get sessionId() {
        return conversationIdRef.current || undefined;
      },
    };
    const onTrigger = (t: TriggerName) => fireNudgeRef.current(t);
    const cleanupIdle = setupIdleTrigger(cfg, onTrigger);
    const cleanupExit = setupExitIntentTrigger(cfg, onTrigger);
    return () => {
      cleanupIdle();
      cleanupExit();
    };
  }, [merchantId]);
}

export function useProactiveMode(
  agentMode: "silent_until_trigger" | "proactive" | "manual_only" | undefined,
  agentInitialDelaySeconds: number | undefined,
  initConversation: () => void,
  selectChannel: (ch: "chat" | "voice") => void,
) {
  const selectChannelRef = useRef(selectChannel);
  selectChannelRef.current = selectChannel;
  const initConversationRef = useRef(initConversation);
  initConversationRef.current = initConversation;
  const proactiveFiredRef = useRef(false);

  useEffect(() => {
    if (agentMode !== "proactive") return;
    if (proactiveFiredRef.current) return;
    initConversationRef.current();
    const delaySec = agentInitialDelaySeconds ?? 5;
    const timer = setTimeout(() => {
      proactiveFiredRef.current = true;
      selectChannelRef.current("chat");
    }, delaySec * 1000);
    return () => clearTimeout(timer);
  }, [agentMode, agentInitialDelaySeconds]);
}

export function useReturnOrderTracking(returnOrderId: string | undefined) {
  const trackedOrderRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!returnOrderId) return;
    if (trackedOrderRef.current === returnOrderId) return;
    trackedOrderRef.current = returnOrderId;
    trackPurchase(returnOrderId, 0);
  }, [returnOrderId]);
}
