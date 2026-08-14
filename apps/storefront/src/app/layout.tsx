import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
