type Block = { type: string; data?: Record<string, unknown> };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/^(?:pagar|pague)(?: com| via)?\s+/, "");

/** A rendered payment choice owns its action; retain other conversational replies. */
export function checkoutQuickReplies(replies: string[], blocks: Block[], permittedKeys: string[]): string[] {
  const choices = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "payment_methods" || !Array.isArray(block.data?.methods)) continue;
    for (const method of block.data.methods as Array<{ key: string; label: string }>) {
      if (method.key === "boleto" || !permittedKeys.includes(method.key)) continue;
      choices.add(normalize(method.key));
      choices.add(normalize(method.label));
      if (method.key === "credito") { choices.add("cartao"); choices.add("cartao de credito"); choices.add("cartao credito"); }
      if (method.key === "debito") { choices.add("cartao de debito"); choices.add("cartao debito"); }
    }
  }
  return replies.filter(reply => !choices.has(normalize(reply)));
}
