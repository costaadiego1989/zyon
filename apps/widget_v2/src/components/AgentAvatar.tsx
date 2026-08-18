import { PulseAgentOrb } from "./PulseAgentOrb";

interface AgentAvatarProps {
  /** Destaque no bloco ativo da conversa */
  active?: boolean;
}

/** Avatar do agente no chat — wrapper fino sobre PulseAgentOrb. */
export function AgentAvatar({ active = true }: AgentAvatarProps) {
  return (
    <PulseAgentOrb
      placement="chatBubble"
      active={active}
      style={{ marginTop: "2px" }}
    />
  );
}
