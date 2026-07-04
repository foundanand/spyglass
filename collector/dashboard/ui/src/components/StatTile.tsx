import { Sparkline } from "./Sparkline.js";

export type StatAccent = "event" | "pageview" | "error" | "network" | "bug" | "accent";

const ACCENT_VAR: Record<StatAccent, string> = {
  event: "var(--c-event)",
  pageview: "var(--c-pageview)",
  error: "var(--c-error)",
  network: "var(--c-network)",
  bug: "var(--c-bug)",
  accent: "var(--accent)",
};

// A compact numbers-first metric card. Optional micro-sparkline.
export function StatTile({
  label,
  value,
  spark,
  accent = "accent",
}: {
  label: string;
  value: number | string;
  spark?: number[];
  accent?: StatAccent;
}) {
  const color = ACCENT_VAR[accent];
  return (
    <div class="stat-tile" style={`--tile-accent:${color}`}>
      <div class="stat-tile-head">
        <span class="stat-label">{label}</span>
      </div>
      <div class="stat-value">{value}</div>
      {spark && spark.length > 1 && (
        <div class="stat-spark">
          <Sparkline values={spark} width={100} height={22} color={color} strokeWidth={1.3} />
        </div>
      )}
    </div>
  );
}

// Flex row wrapper for a set of StatTiles.
export function StatStrip({ children }: { children: preact.ComponentChildren }) {
  return <div class="stat-strip">{children}</div>;
}
