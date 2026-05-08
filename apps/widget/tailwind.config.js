import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    join(__dirname, "index.html"),
    join(__dirname, "enterprise-chat-demo.html"),
    join(__dirname, "src/**/*.{ts,tsx,js,jsx}")
  ],
  theme: {
    extend: {
      fontFamily: {
        merchant: ["var(--aacp-font)"]
      },
      boxShadow: {
        "agentic-glow": "0 28px 90px rgba(2, 6, 23, 0.28)",
        "agentic-card": "0 18px 50px rgba(15, 23, 42, 0.12)"
      },
      keyframes: {
        "aacp-pulse": {
          "0%, 100%": { opacity: "0.55", transform: "scale(0.92)" },
          "50%": { opacity: "1", transform: "scale(1)" }
        },
        "aacp-float": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -8px, 0)" }
        }
      },
      animation: {
        "aacp-pulse": "aacp-pulse 1.2s ease-in-out infinite",
        "aacp-float": "aacp-float 6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
