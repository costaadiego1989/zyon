import type { Metadata } from "next";
import "./globals.css";
import "@zyon/widget/styles/design-system/tokens.css";
import "@zyon/widget/styles/features/pulse/pulse-skin.css";
import "@zyon/widget/styles/features/pulse/styles/animations.css";

export const metadata: Metadata = {
  title: "Zyon Store",
  description: "Zyon Store Builder — conversation-first storefronts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      {}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
