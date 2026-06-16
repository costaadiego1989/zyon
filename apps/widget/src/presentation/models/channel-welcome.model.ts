export type ChannelWelcomeModel = {
  visible: boolean;
  colorMode: "light" | "dark";
  agentName: string;
  merchantName: string;
  agentAvatarUrl?: string;
  channelReady: boolean;
  busy: boolean;
  networkError: string | null;
  onRetry: () => void;
  onSelectVoice: () => void;
  onSelectChat: () => void;
};
