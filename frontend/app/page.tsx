import type { Metadata } from "next";
import VoiceConsole from "@/components/VoiceConsole";

export const metadata: Metadata = {
  title: "Voice Agent Console",
  description:
    "Browser console for the n8n + Ollama LiveKit voice agent: push-to-talk, live transcripts, tool activity.",
};

export default function HomePage() {
  return <VoiceConsole />;
}
