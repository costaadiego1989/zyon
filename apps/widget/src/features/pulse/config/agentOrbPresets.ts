/** Expressão do agente — única variação visual além do tamanho. */
export type AgentOrbMood = 'happy' | 'sad' | 'neutral';

/** Locais onde o orb aparece — tamanho e mood definidos aqui (single source of truth). */
export type AgentOrbPlacement =
  | 'intro'
  | 'header'
  | 'headerEmpty'
  | 'support'
  | 'chatBubble'
  | 'chatLoading'
  | 'cartEmpty'
  | 'orderComplete';

export interface AgentOrbPreset {
  size: number;
  mood: AgentOrbMood;
  muted?: boolean;
  ring?: boolean;
  float?: boolean;
  glow?: boolean;
  spin?: boolean;
}

/** Presets por localização — efeitos decorativos (anel, flutuação, etc.) ficam aqui, não nos views. */
export const AGENT_ORB_PRESETS: Record<AgentOrbPlacement, AgentOrbPreset> = {
  intro: { size: 96, mood: 'happy', ring: true, float: true, glow: true },
  header: { size: 32, mood: 'happy' },
  headerEmpty: { size: 32, mood: 'sad' },
  support: { size: 32, mood: 'happy' },
  chatBubble: { size: 26, mood: 'happy' },
  chatLoading: { size: 54, mood: 'neutral', spin: true },
  cartEmpty: { size: 90, mood: 'sad', ring: true, float: true },
  orderComplete: { size: 72, mood: 'sad', ring: true, float: true },
};

export function resolveAgentOrbPreset(placement: AgentOrbPlacement): AgentOrbPreset {
  return AGENT_ORB_PRESETS[placement];
}
