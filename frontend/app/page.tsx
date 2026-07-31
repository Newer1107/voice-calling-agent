import type { Metadata } from "next";
import VoiceConsole from "@/components/VoiceConsole";

export const metadata: Metadata = {
  title: "Voice Agent Console",
  description:
    "Browser console for the n8n + Ollama LiveKit voice agent: push-to-talk, live transcripts, tool activity.",
};

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
          Voice Agent Console
        </h1>
        <p className="text-sm text-slate-400">
          Live conversation with the n8n + Ollama voice agent. Your mic streams
          over LiveKit; transcripts and tool activity stream back in real time.
        </p>
      </header>
      <VoiceConsole />
    </main>
  );
}
