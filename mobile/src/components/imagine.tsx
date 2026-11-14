import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Logo } from "./logo";
import { VideoJobCard, type VideoJob } from "./video-job-card";
import { api } from "@/lib/api";
import type { SourceClip } from "@/lib/video-upload";
import { C, SIZE } from "@/lib/chat-theme";

export type GeneratedImage = { id: string; prompt: string; uri: string };

const STYLES = ["Default", "Cinematic", "Anime", "Photo", "Sketch"] as const;

/**
 * The Imagine tab: a prompt card (text, Upload, Style, Generate) above a two-column gallery.
 * The server has no image-generation endpoint yet, so Generate reports that instead of inventing
 * pictures; pass `onGenerate` (returning the new image) when one exists and the gallery fills in.
 */
export function ImagineView({ onGenerate, kind, onKindChange, clip, onClearClip }: { onGenerate?: (prompt: string, style: string) => Promise<GeneratedImage>; kind: "image" | "video"; onKindChange: (kind: "image" | "video") => void; clip?: SourceClip | null; onClearClip?: () => void }) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("Default");
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (kind === "video") {
      setBusy(true); setError("");
      try {
        const body = clip ? { kind: "edit_video", prompt: text, inputUrl: clip.videoUrl } : { kind: "create_video", prompt: text };
        const r = await api<{ job: VideoJob }>("/api/jobs", { method: "POST", body });
        setJobs(list => [r.job, ...list]); setPrompt("");
        if (clip) onClearClip?.(); // the server deletes the clip when the edit finishes
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      return;
    }
    if (!onGenerate) { setError("Image generation isn't connected to the A-Zee server yet."); return; }
    setBusy(true); setError("");
    try {
      const image = await onGenerate(text, style);
      setImages(list => [image, ...list]); setPrompt("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const chip = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: C.pill };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, paddingBottom: 28, flexGrow: 1 }}>
      <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 16, marginBottom: 16 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", alignSelf: "flex-start", backgroundColor: C.bg, borderRadius: 999, padding: 3, marginBottom: 12 }}>
          {(["image", "video"] as const).map(k => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: kind === k }} onPress={() => { onKindChange(k); setError(""); }}
              style={{ paddingHorizontal: 16, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: kind === k ? C.pill : "transparent" }}>
              <Text style={{ color: kind === k ? C.ink : C.muted, fontSize: 13, fontWeight: "600" }}>{k === "image" ? "Image" : "Video"}</Text>
            </Pressable>
          ))}
        </View>
        {kind === "video" && clip ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: C.bg, marginBottom: 10 }}>
            <Text numberOfLines={1} style={{ color: C.ink, fontSize: 13, flex: 1 }}>🎬 {clip.fileName}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove video" hitSlop={10} onPress={() => onClearClip?.()}><Text style={{ color: C.muted, fontSize: 16, paddingLeft: 12 }}>✕</Text></Pressable>
          </View>
        ) : null}
        <TextInput
          accessibilityLabel="Describe the image" value={prompt} onChangeText={t => { setPrompt(t); setError(""); }} multiline editable={!busy}
          placeholder={kind === "video" ? (clip ? "Describe how to edit this video…" : "Describe the video you want…") : "Describe the image you want…"} placeholderTextColor={C.muted} selectionColor={C.ink}
          style={{ color: C.ink, fontSize: SIZE.placeholder, lineHeight: 24, minHeight: 72, maxHeight: 160, textAlignVertical: "top", padding: 0 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Upload a photo" onPress={() => Alert.alert("Upload", "Photo upload isn't available in the app yet.")} style={chip}>
              <Text style={{ fontSize: 14 }}>📷</Text><Text style={{ color: C.ink, fontSize: 13, fontWeight: "500" }}>Upload</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Style: ${style}`} onPress={() => setStyle(STYLES[(STYLES.indexOf(style) + 1) % STYLES.length])} style={chip}>
              <Text style={{ fontSize: 14 }}>✨</Text><Text style={{ color: C.ink, fontSize: 13, fontWeight: "500" }}>{style === "Default" ? "Style" : style}</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !prompt.trim(), busy }} disabled={busy || !prompt.trim()} onPress={() => void generate()}
            style={{ height: 38, paddingHorizontal: 18, borderRadius: 19, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", opacity: busy || !prompt.trim() ? 0.45 : 1 }}>
            <Text style={{ color: C.bg, fontSize: SIZE.control, fontWeight: "600" }}>{busy ? "Generating…" : "Generate"}</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{error}</Text> : null}
      </View>

      {jobs.length ? <View style={{ gap: 12, marginBottom: 16 }}>{jobs.map(j => <VideoJobCard key={j.id} job={j} />)}</View> : null}

      {images.length === 0 && jobs.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 }}><Logo size={44} color={C.watermark} /></View>
      ) : images.length === 0 ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {images.map(img => (
            <View key={img.id} style={{ width: "48%", aspectRatio: 1, borderRadius: 16, overflow: "hidden", backgroundColor: C.surface }}>
              <Image source={{ uri: img.uri }} accessibilityLabel={img.prompt} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 8, flexDirection: "row", justifyContent: "space-between", backgroundColor: "rgba(0,0,0,0.55)" }}>
                <Text style={{ color: C.ink, fontSize: 12 }}>Make video</Text><Text style={{ color: C.ink, fontSize: 12 }}>⋯</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
