import React from "react";
import { createRoot } from "react-dom/client";
import { CartProvider } from "../src/lib/cart-store";
import { useConversationViewModel } from "../src/lib/viewmodels/useConversationViewModel";
import { MarketingConsentOpening } from "../src/components/MarketingConsentOpening";
const merchantId = new URLSearchParams(location.search).get("merchant")!;
function Conversation() {
  const vm = useConversationViewModel({
    merchantId,
    storeName: "Loja Local",
    marketingCrmEnabled: true,
    agentMode: "manual_only",
  });
  return (
    <main
      style={{
        maxWidth: 680,
        margin: "auto",
        padding: 20,
        fontFamily: "sans-serif",
      }}
    >
      {vm.marketingChoiceRequired ? (
        <MarketingConsentOpening
          storeName="Loja Local"
          onChoice={(choice) => {
            vm.chooseMarketing(choice);
            vm.selectChannel("chat");
          }}
        />
      ) : (
        <>
          <p role="status">
            {vm.humanHandoff ? "Atendimento humano" : "Assistente disponível"}
          </p>
          <ol aria-label="Mensagens">
            {vm.messages.map((message) => (
              <li key={message.id}>{message.text}</li>
            ))}
          </ol>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void vm.sendMessage(vm.input);
            }}
          >
            <label>
              Mensagem
              <input
                value={vm.input}
                onChange={(event) => vm.setInput(event.target.value)}
              />
            </label>
            <button disabled={vm.isLoading}>Enviar</button>
          </form>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <CartProvider merchantId={merchantId}>
    <Conversation />
  </CartProvider>
);
