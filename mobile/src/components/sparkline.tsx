import { useState } from "react";
import { View } from "react-native";

/** A small trend line drawn with plain views (no chart library, so no native rebuild). It stretches to fit the space it is given. */
export function Sparkline({ points, height = 34, color = "#1769ff", fill = "#e2ecff" }: { points: number[]; height?: number; color?: string; fill?: string }) {
  const [w, setW] = useState(0);
  const n = points.length;
  const nodes: React.ReactNode[] = [];
  if (w > 8 && n >= 2) {
    let min = Math.min(...points), max = Math.max(...points);
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const pad = 4, inner = height - pad * 2;
    const yOf = (v: number) => pad + ((max - v) / (max - min)) * inner;
    const step = 2;
    let prev: number | null = null;
    for (let x = 0; x < w - 4; x += step) {
      const fi = (x / (w - 5)) * (n - 1);
      const i0 = Math.floor(fi), i1 = Math.min(n - 1, i0 + 1), f = fi - i0;
      const y = yOf(points[i0] + (points[i1] - points[i0]) * f);
      const y0: number = prev ?? y;
      nodes.push(<View key={`a${x}`} style={{ position: "absolute", left: x, top: y, width: step, height: Math.max(0, height - y), backgroundColor: fill }} />);
      nodes.push(<View key={`l${x}`} style={{ position: "absolute", left: x, top: Math.min(y, y0) - 0.5, width: step, height: Math.abs(y - y0) + 1.5, backgroundColor: color }} />);
      prev = y;
    }
    if (prev != null) nodes.push(<View key="dot" style={{ position: "absolute", left: w - 9, top: prev - 3.5, width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />);
  }
  return <View accessibilityRole="image" accessibilityLabel="Price trend" onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, overflow: "hidden" }} pointerEvents="none">{nodes}</View>;
}
