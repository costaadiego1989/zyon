import { useLayoutEffect, useState } from "react";
import { useAgentBlockDelay } from "../../../../widget_v2/src/lib/use-agent-block-delay";

type Message = { id: string; role: string; text?: string; controls: boolean };

export function BlockDelayHarness() {
  const [scope, setScope] = useState("first");
  const [counter, setCounter] = useState(0);
  const [shiftClock, setShiftClock] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: "history", role: "agent", text: "Mensagem do histórico", controls: true },
  ]);
  const pending = useAgentBlockDelay(messages, scope);
  useLayoutEffect(() => {
    if (!shiftClock) return;
    const originalNow = Date.now;
    Date.now = () => originalNow() + 5;
    return () => { Date.now = originalNow; };
  }, [shiftClock]);
  return <>
    <button onClick={() => setMessages((previous) => [...previous,
      { id: "reply", role: "agent", text: "Aqui está sua resposta", controls: true }])}>Nova resposta</button>
    <button onClick={() => setCounter(counter + 1)}>Renderizar novamente {counter}</button>
    <button onClick={() => { setMessages((previous) => [...previous]); setShiftClock(true); }}>Atravessar prazo na renderização</button>
    <button onClick={() => setMessages((previous) => previous.filter((message) => message.id !== "reply"))}>Remover resposta</button>
    <button onClick={() => { setScope("second"); setMessages([
      { id: "restored", role: "agent", text: "Conversa restaurada", controls: true },
    ]); }}>Trocar conversa</button>
    <button onClick={() => setMessages((previous) => [...previous,
      { id: "block-only", role: "agent", controls: true }])}>Somente componente</button>
    <button onClick={() => setMessages((previous) => [...previous,
      { id: "late", role: "agent", text: "Texto antes dos dados", controls: false }])}>Texto primeiro</button>
    <button onClick={() => setMessages((previous) => previous.map((message) => message.id === "late"
      ? { ...message, controls: true } : message))}>Adicionar dados</button>
    {messages.map((message) => <section key={message.id}>
      <p>{message.text}</p>
      {message.controls && !pending.has(message.id) && <button>{`Componente ${message.id}`}</button>}
    </section>)}
  </>;
}
