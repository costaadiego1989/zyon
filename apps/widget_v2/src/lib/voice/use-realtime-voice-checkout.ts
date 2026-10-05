import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeVoiceInput, RealtimeVoiceResponses, VOICE_MICROPHONE_CONSTRAINTS, type VoiceInputEvent } from "@zyon/shared-types";

export type RealtimeVoiceTurnResult = { agentMessage: string; cart?: { itemCount: number; total: number } };
type ClientSecret = { value: string; expires_at?: number };
type Options = {
  enabled: boolean;
  createSession: () => Promise<ClientSecret>;
  onCommerceTurn: (buyerMessage: string, action: "commerce" | "add_item_to_cart") => Promise<RealtimeVoiceTurnResult>;
  onBeginCheckout: () => Promise<RealtimeVoiceTurnResult>;
  getContext?: () => Promise<{ instructions: string }>;
  contextKey?: string;
  ready?: boolean;
};
export type RealtimeVoiceCheckoutState = { connecting: boolean; connected: boolean; listening: boolean; speaking: boolean; unsupported: boolean; hint: string; start: () => void; stop: () => void; toggle: () => void };
type EventPayload = VoiceInputEvent & { item?: { type?: string; name?: string; call_id?: string; arguments?: string }; delta?: string };

export function useRealtimeVoiceCheckout({ enabled, createSession, onCommerceTurn, onBeginCheckout, getContext, contextKey, ready = true }: Options): RealtimeVoiceCheckoutState {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [hint, setHint] = useState("Ative a voz para começar.");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handled = useRef(new Set<string>());
  const starting = useRef(false);
  const connectionAttempt = useRef(0);
  const inputTurns = useRef(new RealtimeVoiceInput());
  const responses = useRef<RealtimeVoiceResponses | null>(null);
  const contextRef = useRef(getContext);
  const contextQueue = useRef<Promise<void>>(Promise.resolve());
  const readyRef = useRef(ready);
  const lastContextKey = useRef<string | undefined>(undefined);
  const sessionRef = useRef(createSession);
  const commerceRef = useRef(onCommerceTurn);
  const checkoutRef = useRef(onBeginCheckout);
  sessionRef.current = createSession; commerceRef.current = onCommerceTurn; checkoutRef.current = onBeginCheckout;
  contextRef.current = getContext; readyRef.current = ready;

  const stop = useCallback(() => {
    connectionAttempt.current += 1;
    starting.current = false;
    const channel = channelRef.current;
    const peer = peerRef.current;
    channelRef.current = null; peerRef.current = null;
    channel?.close(); peer?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    audioRef.current = null; handled.current.clear();
    inputTurns.current = new RealtimeVoiceInput(); responses.current = null; contextQueue.current = Promise.resolve();
    lastContextKey.current = undefined;
    setConnecting(false); setConnected(false); setListening(false); setSpeaking(false);
    setHint(enabled ? "Voz pausada. Toque para retomar." : "Ative a voz para começar.");
  }, [enabled]);

  const refreshContext = useCallback(() => {
    const channel = channelRef.current;
    const task = contextQueue.current.catch(() => {}).then(async () => {
      if (!contextRef.current || channel !== channelRef.current || channel?.readyState !== "open") return;
      const context = await contextRef.current();
      if (channel !== channelRef.current || channel.readyState !== "open") return;
      channel.send(JSON.stringify({ type: "session.update", session: { type: "realtime", instructions: context.instructions } }));
    });
    contextQueue.current = task;
    return task;
  }, []);

  const onEvent = useCallback(async (event: EventPayload) => {
    const sourceChannel = channelRef.current;
    responses.current?.receive(event.type);
    const decision = inputTurns.current.receive(event);
    if (decision) {
      if (decision.kind !== "speech") {
        sourceChannel?.send(JSON.stringify({ type: "conversation.item.delete", item_id: decision.itemId }));
        setListening(false);
        setHint(decision.kind === "failed" ? "Não entendi esse trecho. Pode repetir ou digitar." : "Pode falar quando quiser.");
        return;
      }
      try { await refreshContext(); }
      catch { stop(); setHint("Não consegui atualizar sua compra por voz. Continue pelo chat ou tente retomar."); return; }
      if (channelRef.current !== sourceChannel) return;
      responses.current?.request(true);
      return;
    }
    if (event.type === "input_audio_buffer.speech_started") { setListening(true); setSpeaking(false); setHint("Estou ouvindo..."); return; }
    if (event.type === "input_audio_buffer.speech_stopped") { setListening(false); setHint("Entendendo seu pedido..."); return; }
    if (event.type === "response.output_audio_transcript.delta" && event.delta) { setSpeaking(true); setHint("Estou respondendo..."); return; }
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.done" || event.type === "response.completed") { setSpeaking(false); if (peerRef.current) setHint("Pode falar quando quiser."); return; }
    if (event.type !== "response.output_item.done" || event.item?.type !== "function_call") return;
    const actionName = event.item.name;
    if (actionName !== "handoff_to_commerce_agent" && actionName !== "add_item_to_cart" && actionName !== "begin_checkout" && actionName !== "correct_customer_details") return;
    const callId = event.item.call_id;
    if (!callId || handled.current.has(callId)) return;
    handled.current.add(callId);
    let buyerMessage = "";
    try {
      const args = JSON.parse(event.item.arguments ?? "{}") as { buyer_message?: unknown; field?: unknown; new_value?: unknown };
      buyerMessage = typeof args.buyer_message === "string" ? args.buyer_message.trim().slice(0, 1_000) : "";
      if (actionName === "correct_customer_details" && typeof args.field === "string") {
        const fields: Record<string, string> = { email: "meu e-mail", phone: "meu celular", fullName: "meu nome completo", cpf: "meu CPF", zip: "meu CEP", number: "o número do imóvel", complement: "o complemento" };
        const field = Object.hasOwn(fields, args.field) ? fields[args.field] : undefined;
        const value = typeof args.new_value === "string" && !/[\[\]<>]|digite|informe|placeholder/i.test(args.new_value) ? args.new_value.trim().slice(0, 320) : "";
        buyerMessage = field ? `Quero corrigir ${field}${value ? ` para ${value}` : "."}` : "";
      }
    } catch { /* safe fallback below */ }
    let output: RealtimeVoiceTurnResult | { error: string };
    if (actionName === "begin_checkout") {
      setHint("Abrindo a finalização segura...");
      try { output = await checkoutRef.current(); } catch { output = { error: "Não consegui abrir a finalização agora. Peça para tentar novamente." }; }
    } else if (!buyerMessage) output = { error: "Não consegui entender o pedido. Peça para a pessoa repetir." };
    else {
      setHint(actionName === "correct_customer_details" ? "Conferindo a correção..." : actionName === "add_item_to_cart" ? "Adicionando ao carrinho..." : "Consultando a loja...");
      try { output = await commerceRef.current(buyerMessage, actionName === "add_item_to_cart" ? "add_item_to_cart" : "commerce"); } catch { output = { error: "A loja não conseguiu concluir esta etapa agora. Peça para tentar novamente." }; }
    }
    const channel = channelRef.current;
    if (channel !== sourceChannel || channel?.readyState !== "open") return;
    try { await refreshContext(); }
    catch { stop(); setHint("Sua compra foi atualizada no chat. Toque para retomar a voz."); return; }
    if (channelRef.current !== sourceChannel || channel.readyState !== "open") return;
    channel.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } }));
    responses.current?.request();
  }, [refreshContext, stop]);

  const start = useCallback(() => {
    if (!enabled || !readyRef.current || starting.current || peerRef.current) return;
    const attempt = ++connectionAttempt.current;
    void (async () => {
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { setUnsupported(true); setHint("Este navegador não suporta a compra por voz. Use o chat para continuar."); return; }
      starting.current = true; setConnecting(true); setHint("Conectando sua voz com segurança...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia(VOICE_MICROPHONE_CONSTRAINTS);
        if (attempt !== connectionAttempt.current) { stream.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = stream;
        const secret = await sessionRef.current();
        if (attempt !== connectionAttempt.current) return;
        if (!secret.value) throw new Error("voice_session_missing");
        const peer = new RTCPeerConnection(); peerRef.current = peer;
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        audio.setAttribute("data-zyon-realtime-audio", "true");
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioRef.current = audio;
        peer.ontrack = (event) => {
          if (attempt !== connectionAttempt.current) return;
          audio.srcObject = event.streams[0] ?? null;
          void audio.play().catch(() => setHint("O navegador bloqueou o áudio. Toque no microfone para ouvir."));
        };
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        const channel = peer.createDataChannel("oai-events"); channelRef.current = channel;
        responses.current = new RealtimeVoiceResponses(event => {
          if (channelRef.current === channel && channel.readyState === "open") channel.send(JSON.stringify(event));
        });
        channel.addEventListener("message", (message) => { if (attempt !== connectionAttempt.current) return; try { void onEvent(JSON.parse(message.data) as EventPayload); } catch { /* ignore */ } });
        channel.addEventListener("open", () => {
          void (async () => {
            if (attempt !== connectionAttempt.current) return;
            try { await refreshContext(); }
            catch { if (attempt === connectionAttempt.current) { stop(); setHint("Não consegui atualizar a etapa do pedido. Tente retomar a voz."); } return; }
            if (attempt !== connectionAttempt.current) return;
            setConnected(true); setConnecting(false); setHint("Conectada. Vou continuar seu pedido."); responses.current?.request();
          })();
        });
        channel.addEventListener("close", () => { if (peerRef.current === peer) stop(); });
        peer.addEventListener("connectionstatechange", () => { if (["failed", "closed", "disconnected"].includes(peer.connectionState) && peerRef.current === peer) stop(); });
        const offer = await peer.createOffer();
        if (attempt !== connectionAttempt.current) return;
        await peer.setLocalDescription(offer); await waitForIce(peer);
        if (attempt !== connectionAttempt.current) return;
        const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" }, body: peer.localDescription?.sdp ?? offer.sdp });
        if (attempt !== connectionAttempt.current) return;
        if (!response.ok) {
          const error = new Error("voice_connection_failed") as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        const answer = await response.text();
        if (attempt !== connectionAttempt.current) return;
        await peer.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (error) {
        if (attempt !== connectionAttempt.current) return;
        stop(); setHint(voiceErrorHint(error));
      } finally { if (attempt === connectionAttempt.current) { starting.current = false; setConnecting(false); } }
    })();
  }, [enabled, onEvent, refreshContext, stop]);
  const resumeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.srcObject || !audio.paused) return false;
    void audio.play()
      .then(() => setHint("Pode falar quando quiser."))
      .catch(() => setHint("O navegador ainda bloqueia o áudio. Verifique as permissões de som deste site."));
    return true;
  }, []);
  const toggle = useCallback(() => {
    if (peerRef.current || connecting) {
      if (!connecting && resumeAudio()) return;
      stop();
      return;
    }
    start();
  }, [connecting, resumeAudio, start, stop]);
  useEffect(() => { if (!enabled) stop(); }, [enabled, stop]);
  useEffect(() => {
    if (!connected || !ready) return;
    if (lastContextKey.current !== undefined && lastContextKey.current !== contextKey) responses.current?.interrupt();
    lastContextKey.current = contextKey;
    void refreshContext().catch(() => { stop(); setHint("Não consegui atualizar a etapa do pedido. Tente retomar a voz."); });
  }, [connected, contextKey, ready, refreshContext, stop]);
  useEffect(() => () => stop(), [stop]);
  return { connecting, connected, listening, speaking, unsupported, hint, start, stop, toggle };
}

function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => { const timeout = window.setTimeout(done, 1_500); function done() { window.clearTimeout(timeout); peer.removeEventListener("icegatheringstatechange", change); resolve(); } function change() { if (peer.iceGatheringState === "complete") done(); } peer.addEventListener("icegatheringstatechange", change); });
}

function voiceErrorHint(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status);
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Permita o uso do microfone para iniciar a compra por voz.";
  if (name === "NotFoundError") return "Não encontrei um microfone neste dispositivo. Use o chat para continuar.";
  if (status === 401) return "Sua sessão expirou. Atualize a página e tente ativar a voz novamente.";
  if (status === 403) return "Não foi possível iniciar a voz nesta sessão. Tente novamente ou continue pelo chat.";
  if (status === 429) return "A voz está temporariamente ocupada. Aguarde um instante e tente novamente.";
  if (status >= 500) return "A assistente de voz está indisponível agora. Tente novamente em instantes ou use o chat.";
  return "Não consegui ativar a voz agora. Tente novamente ou use o chat.";
}
