/** Complete application labels start a store-help conversation. Arbitrary prose,
 * attachments and mixed instructions keep the normal admission path. */
export function knowledgeHelpNavigation(message: string): string | undefined {
  const label = message.trim().toLocaleLowerCase("pt-BR");
  if (!["faq", "ajuda", "suporte", "perguntas frequentes"].includes(label)) return undefined;
  return "Quero ajuda sobre esta loja. Consulte as informações da base de conhecimento da loja, explique brevemente como pode me ajudar e pergunte qual é minha dúvida. Não liste perguntas e respostas prontas nem invente condições que a loja não publicou.";
}
