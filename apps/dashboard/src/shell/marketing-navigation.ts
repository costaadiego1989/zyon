const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readMarketingNavigation(hash: string) {
  const [page, query] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query ?? "");
  const contact = params.get("contactId"),
    conversation = params.get("conversationId"),
    view = params.get("view");
  return {
    contactId:
      page === "marketing" && contact && uuid.test(contact)
        ? contact
        : undefined,
    conversationId:
      page === "conversations" && conversation && uuid.test(conversation)
        ? conversation
        : undefined,
    view:
      page === "marketing" && (view === "campaigns" || view === "settings")
        ? view
        : ("contacts" as "contacts" | "campaigns" | "settings"),
  };
}
export function marketingHash(
  page: "marketing" | "conversations",
  input: {
    contactId?: string;
    conversationId?: string;
    view?: "contacts" | "campaigns" | "settings";
  } = {}
) {
  const params = new URLSearchParams();
  if (input.contactId && uuid.test(input.contactId))
    params.set("contactId", input.contactId);
  if (input.conversationId && uuid.test(input.conversationId))
    params.set("conversationId", input.conversationId);
  if (input.view && input.view !== "contacts") params.set("view", input.view);
  return `${page}${params.size ? `?${params}` : ""}`;
}
