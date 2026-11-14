import Link from "next/link";

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
        background:
          "linear-gradient(180deg, var(--color-bg) 0%, var(--color-bg-soft) 100%)",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 56,
            lineHeight: 1,
          }}
        >
          🛍️
        </span>
        <h1
          style={{
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--color-fg)",
          }}
        >
          Store Builder
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-fg-soft)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Conversation-first storefronts powered by Zyon.
          <br />
          Coming soon.
        </p>
        <div style={{ marginTop: 16 }}>
          <Link
            href="/store/demo"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              background: "var(--color-primary)",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View demo store →
          </Link>
        </div>
      </div>
    </main>
  );
}
