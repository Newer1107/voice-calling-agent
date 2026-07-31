import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Agent Console",
  description:
    "Browser console for the n8n + Ollama LiveKit voice agent: push-to-talk, live transcripts, tool activity.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-slate-950 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
