/**
 * WhatsApp Menu Renderer — Numbered menu state machine.
 *
 * Converts quick replies into numbered text menus and resolves
 * numeric input back to the original quick reply text.
 * Pure domain logic — no NestJS or I/O dependencies.
 */

export interface MenuState {
  currentOptions: string[];
  previousOptions: string[];
  page: number;
  context: "products" | "categories" | "menu" | "confirmation" | "payment";
}

export interface ResolvedInput {
  text: string;
  action: "select" | "back" | "more" | "freetext";
  index?: number;
}

/**
 * Resolve a buyer's numbered input against the current menu state.
 *
 * Rules:
 * - "0" → go back (return previous menu context)
 * - "1"-"10" → select the option at that index
 * - In paginated product lists, the last+1 number is "load more"
 * - Anything else → free text, pass to LLM
 */
export function resolveNumberedInput(input: string, state: MenuState): ResolvedInput {
  const trimmed = input.trim();

  // "0" always means back
  if (trimmed === "0") {
    return {
      text: state.previousOptions[0] ?? "Voltar",
      action: "back",
    };
  }

  const num = parseInt(trimmed, 10);

  // Not a number → free text
  if (Number.isNaN(num) || num < 0 || num > 10) {
    return { text: input, action: "freetext" };
  }

  // In paginated contexts, check if this is "load more"
  if (
    (state.context === "products" || state.context === "categories") &&
    num === state.currentOptions.length + 1
  ) {
    return { text: "__LOAD_MORE__", action: "more", index: num };
  }

  // Valid selection within range
  if (num >= 1 && num <= state.currentOptions.length) {
    return {
      text: state.currentOptions[num - 1],
      action: "select",
      index: num - 1,
    };
  }

  // Number out of range → treat as free text
  return { text: input, action: "freetext" };
}

/**
 * Build a new MenuState from the current quick replies.
 * Preserves previous state for "back" navigation.
 */
export function buildMenuState(
  currentOptions: string[],
  previousState?: MenuState,
  context: MenuState["context"] = "menu",
  page = 0,
): MenuState {
  return {
    currentOptions,
    previousOptions: previousState?.currentOptions ?? [],
    page,
    context,
  };
}

/**
 * Serialize MenuState for persistence (JSON-safe).
 */
export function serializeMenuState(state: MenuState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize MenuState from stored JSON.
 */
export function deserializeMenuState(json: string | null): MenuState | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as MenuState;
  } catch {
    return null;
  }
}
