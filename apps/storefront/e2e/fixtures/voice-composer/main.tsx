import { createRoot } from "react-dom/client";
import ConversationShell from "../../../src/components/ConversationShell";
import "../../../src/app/globals.css";
import "../../../../widget_v2/src/styles/neumorphism.css";
import "../../../../widget_v2/src/styles/perimeter-border.css";

createRoot(document.getElementById("root")!).render(<main className="storefront-shell" style={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%", maxWidth: 640, margin: "0 auto", "--aacp-accent": "#268235", "--aacp-on-accent": "#f8faf9" } as React.CSSProperties}><ConversationShell storeName="Loja de teste" merchantId="voice-qa"
  merchantSlug="voice-qa" agentGreeting="Como posso ajudar?" initialStories={[]} quickReplies={[]}
  voiceCheckoutEnabled={!new URLSearchParams(location.search).has("disabled")} agentMode="manual_only" /></main>);
