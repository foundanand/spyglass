// Relative timestamp ("2m ago") with the absolute time on hover (title).
// Re-renders live via a shared 30s ticker so "just now" ages correctly.
import { useEffect, useState } from "preact/hooks";

export function relTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function RelTime({ ts, class: cls }: { ts: number; class?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span class={cls} title={new Date(ts).toLocaleString()}>
      {relTime(ts)}
    </span>
  );
}
