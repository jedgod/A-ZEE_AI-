/** A small trend line as inline SVG. It stretches to the width it is given. */
export function Sparkline({ points, height = 40, color = '#4f46e5', fill = '#eef2ff', label = 'Price trend' }: { points: number[]; height?: number; color?: string; fill?: string; label?: string }) {
  const n = points.length;
  if (n < 2) return null;
  let min = Math.min(...points), max = Math.max(...points);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const W = 200, pad = 4;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => pad + ((max - v) / (max - min)) * (height - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block' }}>
      <path d={`${line} L${W} ${height} L0 ${height} Z`} fill={fill} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
