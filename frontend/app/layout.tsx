import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Voice Agent Console",
  description:
    "Browser console for the n8n + Ollama LiveKit voice agent: push-to-talk, live transcripts, tool activity.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0D0D0F",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} min-h-dvh bg-graphite-950 font-sans text-ink-high antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
