import { useCheckoutStore } from "@/store/checkout-store";
import { PulseAgentOrb } from "./PulseAgentOrb";

export function ChannelGate() {
  const selectChannel = useCheckoutStore((s) => s.selectChannel);
  const brand = useCheckoutStore((s) => s.brand);
  const agent = useCheckoutStore((s) => s.agent);

  const agentName = agent.name || "Assistente";
  const storeName = brand.name || "Loja";
  const agentGreeting = agent.greeting || "Eu cuido da sua compra do início ao fim: acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "40px 24px",
        textAlign: "center",
        gap: "24px",
        overflow: "auto",
      }}
    >
      {/* Agent Orb */}
      <PulseAgentOrb placement="intro" active />

      {/* Role label */}
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: "var(--aacp-accent, #0f766e)",
        }}
      >
        Gerente de vendas da {storeName}
      </div>

      {/* Greeting */}
      <div>
        <h2
          style={{
            fontSize: "24px",
            fontWeight: 800,
            lineHeight: 1.2,
            margin: "0 0 12px",
            color: "var(--tx)",
          }}
        >
          Oi, eu sou a {agentName}.
        </h2>
        <p
          style={{
            fontSize: "14px",
            lineHeight: 1.6,
            color: "var(--mut)",
            maxWidth: "340px",
            margin: "0 auto",
            whiteSpace: "pre-line",
          }}
        >
          {agentGreeting}
        </p>
      </div>

      {/* Feature list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "360px" }}>
        {[
          { icon: "✦", text: "Acho a melhor opção e aplico promoções" },
          { icon: "📦", text: "Calculo o frete e organizo a entrega" },
          { icon: "💳", text: "Pago com Pix, cartão ou crypto" },
        ].map((item) => (
          <div
            key={item.text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "14px",
              background: "var(--card)",
              border: "1px solid var(--bd)",
              fontSize: "13.5px",
              fontWeight: 500,
              color: "var(--tx)",
            }}
          >
            <span style={{ fontSize: "16px" }}>{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>

      {/* Channel question */}
      <div
        style={{
          fontSize: "15px",
          fontWeight: 700,
          color: "var(--tx)",
          marginTop: "8px",
        }}
      >
        Como você prefere comprar?
      </div>

      {/* Channel buttons */}
      <div style={{ display: "flex", gap: "12px", width: "100%", maxWidth: "340px" }}>
        <button
          type="button"
          onClick={() => selectChannel("chat")}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
            padding: "20px 16px",
            borderRadius: "16px",
            border: "1.5px solid var(--aacp-accent, #0f766e)",
            background: "color-mix(in srgb, var(--aacp-accent) 8%, var(--bg))",
            cursor: "pointer",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--tx)" }}>Por chat</span>
          <span style={{ fontSize: "11px", color: "var(--mut)" }}>Converse digitando</span>
        </button>

        <button
          type="button"
          onClick={() => selectChannel("voice")}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
            padding: "20px 16px",
            borderRadius: "16px",
            border: "1.5px solid var(--aacp-accent, #0f766e)",
            background: "color-mix(in srgb, var(--aacp-accent) 8%, var(--bg))",
            cursor: "pointer",
            transition: "transform 0.15s, box-shadow 0.15s",
            position: "relative",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--tx)" }}>Por voz</span>
          <span style={{ fontSize: "11px", color: "var(--mut)" }}>Fale com a {agentName}</span>
          <span
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              padding: "2px 6px",
              borderRadius: "6px",
              background: "var(--aacp-accent, #0f766e)",
              color: "#fff",
            }}
          >
            IA
          </span>
        </button>
      </div>
    </div>
  );
}
