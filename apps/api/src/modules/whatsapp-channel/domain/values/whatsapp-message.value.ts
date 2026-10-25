/**
 * WhatsApp Message Value Object
 * Represents incoming and outgoing WhatsApp messages
 */

export interface IncomingWhatsAppMessagePayload {
  id: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  fromAlias?: string;
  messageType: "text" | "image" | "audio" | "video" | "document" | "location";
  isGroup: boolean;
  url?: string;
  mimetype?: string;
  deviceID: string;
  timestamp: number;
  messageContext?: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    message?: Record<string, any>;
    messageTimestamp: string;
    status: string;
  };
}

export interface WhatsAppMenuState {
  currentOptions: string[];
  previousOptions: string[];
  page: number;
  context: "products" | "menu" | "confirmation" | "cart" | "payment";
}

export interface ResolvedMenuInput {
  text: string;
  action: "select" | "back" | "more" | "freetext";
  index?: number;
}

export function resolveNumberedInput(
  input: string,
  state: WhatsAppMenuState,
): ResolvedMenuInput {
  const trimmed = input.trim();

  if (trimmed === "0") {
    return { text: trimmed, action: "back" };
  }

  const num = parseInt(trimmed, 10);

  if (!isNaN(num)) {
    const optionIndex = num - 1;
    if (optionIndex >= 0 && optionIndex < state.currentOptions.length) {
      return {
        text: trimmed,
        action: "select",
        index: optionIndex,
      };
    }

    // Check for "more" button (next page marker)
    if (
      state.context === "products" &&
      num === 6 &&
      state.currentOptions.length === 5
    ) {
      return { text: trimmed, action: "more" };
    }
  }

  // Fallback to freetext input
  return { text: trimmed, action: "freetext" };
}

export function renderWhatsAppMenu(
  options: string[],
  title?: string,
  showBack: boolean = true,
  showMore: boolean = false,
): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`*${title}*`);
    lines.push("");
  }

  options.forEach((opt, i) => {
    lines.push(`${i + 1}️⃣ ${opt}`);
  });

  if (showMore) {
    lines.push(`⬇️ ${options.length + 1} — Carregar mais`);
  }

  if (showBack) {
    lines.push("↩️ 0 — Voltar");
  }

  return lines.join("\n");
}
