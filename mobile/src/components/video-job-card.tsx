import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { api } from "@/lib/api";
import { C } from "@/lib/chat-theme";

export type VideoJob = { id: string; status: "processing" | "completed" | "failed"; provider?: "simulated" | "fal"; prompt: string; outputUrl: string | null };

const POLL_MS = 4000;
const GIVE_UP_MS = 10 * 60 * 1000; // stop polling after 10 minutes; the job is still in the account

/**
 * Shows one video job: a rendering spinner while it is processing (polled every 4 seconds), then an
 * "Open video" button that plays it in the phone's player, or a failure notice.
 */
export function VideoJobCard({ job: initial }: { job: VideoJob }) {
  const [job, setJob] = useState(initial);
  const [late, setLate] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (job.status !== "processing") return;
    let alive = true;
    const timer = setInterval(async () => {
      if (Date.now() - started.current > GIVE_UP_MS) { setLate(true); clearInterval(timer); return; }
      try {
        const r = await api<{ job: VideoJob }>(`/api/jobs/${job.id}`);
        if (alive && r.job) setJob(j => ({ ...j, ...r.job }));
      } catch { /* a dropped request is retried on the next tick */ }
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [job.id, job.status]);

  const simulated = job.provider === "simulated";
  const badge = job.status === "completed" ? { text: "Ready", color: C.accentGreen } : job.status === "failed" ? { text: "Failed", color: C.danger } : { text: late ? "Still working" : "Rendering", color: "#fbbf24" };

  return (
    <View accessibilityLabel={`Video: ${badge.text}`} style={{ backgroundColor: C.surface, borderRadius: 18, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomColor: C.line, borderBottomWidth: 1 }}>
        <Text style={{ color: C.ink, fontSize: 13, fontWeight: "600" }}>🎬  A-Zee Video Studio</Text>
        <Text style={{ color: badge.color, fontSize: 12, fontWeight: "600" }}>{badge.text}</Text>
      </View>
      <View style={{ padding: 14, gap: 10 }}>
        <Text numberOfLines={2} style={{ color: C.muted, fontSize: 13 }}>{job.prompt}</Text>
        {job.status === "processing" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={C.ink} />
            <Text style={{ color: C.muted, fontSize: 12 }}>{late ? "This is taking longer than usual. You can leave; it will be here later." : simulated ? "Preview: ready in a few seconds" : "Usually takes 30–60 seconds"}</Text>
          </View>
        ) : null}
        {job.status === "completed" && job.outputUrl ? (
          <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(job.outputUrl!)}
            style={{ height: 44, borderRadius: 22, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: C.bg, fontSize: 15, fontWeight: "600" }}>▶  Open video</Text>
          </Pressable>
        ) : null}
        {simulated && job.status === "completed" ? <Text style={{ color: C.muted, fontSize: 12 }}>Simulated preview: this is a sample clip, not a video made from your prompt. Real videos need a video provider key on the server.</Text> : null}
        {job.status === "failed" ? <Text style={{ color: C.danger, fontSize: 13 }}>Video generation failed. Try a different prompt.</Text> : null}
      </View>
    </View>
  );
}
