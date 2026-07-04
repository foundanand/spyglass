// Deterministic colored avatar: the same user id always maps to the same hue,
// so user lists are scannable at a glance. Pure CSS (oklch), no images/deps.

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function Avatar({ id, size = 24 }: { id: string; size?: number }) {
  const hue = hueFor(id || "?");
  const initial = (id || "?").trim().charAt(0).toUpperCase() || "?";
  const bg = `oklch(0.62 0.14 ${hue})`;
  return (
    <span
      class="avatar"
      style={`width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(
        size * 0.46,
      )}px`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
