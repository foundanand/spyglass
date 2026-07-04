// Minimal inline-SVG sparkline: a stroked line with a soft gradient fill.
// No chart library. Renders nothing meaningful for <2 points.

let gradSeq = 0;

export function Sparkline({
  values,
  width = 120,
  height = 30,
  color = "var(--accent)",
  strokeWidth = 1.5,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}) {
  if (!values || values.length === 0) {
    return <svg class="spark" width={width} height={height} />;
  }
  const pad = strokeWidth + 1;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;
  const dx = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const y = (v: number) =>
    height - pad - ((v - min) / span) * (height - pad * 2);
  const pts = values.map((v, i) => [pad + i * dx, y(v)] as const);
  const line = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
  const gid = `sg${gradSeq++}`;
  return (
    <svg class="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
