import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        // Graphite world — dark, warm-neutral, calm.
        graphite: {
          950: "#0D0D0F", // page background
          900: "#151518", // surface
          850: "#1B1B1F", // elevated cards / controls
          800: "#232329", // elevated hover / active segment
          700: "#2C2C34",
        },
        // Border hierarchy — almost invisible; separation comes from
        // elevation and whitespace, not outlines.
        line: {
          DEFAULT: "rgba(255,255,255,0.06)",
          soft: "rgba(255,255,255,0.035)",
          strong: "rgba(255,255,255,0.12)",
        },
        // Text hierarchy is weight + size first; these four levels support it.
        ink: {
          high: "#F2F2F4",
          mid: "#A2A2AC",
          low: "#6E6E78",
          faint: "#4A4A53",
        },
        // One accent, used sparingly.
        accent: {
          DEFAULT: "#3B82F6",
          hover: "#60A5FA",
          soft: "rgba(59,130,246,0.12)",
          border: "rgba(59,130,246,0.35)",
        },
        // Semantic — quiet tints, never glowing.
        success: {
          DEFAULT: "#22C55E",
          soft: "rgba(34,197,94,0.12)",
        },
        warning: {
          DEFAULT: "#F59E0B",
          soft: "rgba(245,158,11,0.12)",
        },
        error: {
          DEFAULT: "#EF4444",
          soft: "rgba(239,68,68,0.12)",
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.35" },
          "100%": { transform: "scale(1.55)", opacity: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.35" },
          "30%": { transform: "translateY(-2px)", opacity: "1" },
        },
        "bar-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out both",
        "scale-in": "scale-in 180ms ease-out both",
        "slide-up": "slide-up 200ms ease-out both",
        "slide-down": "slide-down 180ms ease-out both",
        blink: "blink 1s steps(2, start) infinite",
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.35, 1) infinite",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        wave: "wave 900ms ease-in-out infinite",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "bar-indeterminate": "bar-indeterminate 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
