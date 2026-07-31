"use client";

import { ConnectionPanel } from "@/components/ConnectionPanel";
import { ControlsPanel } from "@/components/ControlsPanel";
import { ErrorToasts } from "@/components/ErrorToasts";
import { HistoryPanel } from "@/components/HistoryPanel";
import { ToolActivity } from "@/components/ToolActivity";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { useVoiceAgent } from "@/hooks/use-voice-agent";

export default function VoiceConsole() {
  const agent = useVoiceAgent();

  return (
    <>
      <ErrorToasts errors={agent.errors} onDismiss={agent.dismissError} />

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Right rail first on mobile so Connect is reachable before the transcript. */}
        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <ConnectionPanel
            status={agent.status}
            errorDetail={agent.errorDetail}
            livekitUrl={agent.livekitUrl}
            onConnect={agent.connect}
            onDisconnect={agent.disconnect}
          />
          <ControlsPanel
            connected={agent.connected}
            listening={agent.listening}
            speaking={agent.speaking}
            thinking={agent.thinking}
            vadEnabled={agent.vadEnabled}
            pttHeld={agent.pttHeld}
            micEnabled={agent.micEnabled}
            agentName={agent.agentName}
            onStartPtt={agent.startPushToTalk}
            onStopPtt={agent.stopPushToTalk}
            onToggleVad={agent.toggleVad}
          />
          <ToolActivity items={agent.toolActivity} />
          <HistoryPanel entries={agent.conversationHistory} sessionId={agent.sessionId} />
        </div>

        <div className="order-2 lg:order-1">
          <TranscriptPanel
            userTranscript={agent.userTranscript}
            aiMessages={agent.aiMessages}
            agentName={agent.agentName}
            connected={agent.connected}
          />
        </div>
      </div>
    </>
  );
}
