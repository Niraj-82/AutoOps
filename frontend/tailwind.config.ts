import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        accent: {
          cyan: "#22d3ee",
          indigo: "#6366f1",
          violet: "#8b5cf6",
          emerald: "#10b981",
          amber: "#f59e0b",
          rose: "#f43f5e",
        },
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", ...defaultTheme.fontFamily.mono],
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(18px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(34, 211, 238, 0.32), 0 0 16px rgba(99, 102, 241, 0.2)",
          },
          "50%": {
            boxShadow: "0 0 0 6px rgba(34, 211, 238, 0), 0 0 24px rgba(99, 102, 241, 0.38)",
          },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 420ms ease-out both",
        "slide-in": "slide-in 400ms ease-out both",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        shimmer: "shimmer 2.2s linear infinite",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(99, 102, 241, 0.22), 0 12px 30px rgba(3, 8, 20, 0.45)",
        "glow-strong": "0 0 0 1px rgba(34, 211, 238, 0.34), 0 18px 40px rgba(3, 8, 20, 0.62)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
