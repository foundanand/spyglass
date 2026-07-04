// Renders a props object as compact `key: value` chips instead of raw JSON.
// Shows up to `max` chips, then a "+n" toggle that reveals the full JSON.
import { useState } from "preact/hooks";

function fmtVal(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 40) + "…" : v;
  if (typeof v === "object") return Array.isArray(v) ? `[${v.length}]` : "{…}";
  return String(v);
}

export function PropsChips({
  props,
  max = 3,
}: {
  props?: Record<string, unknown>;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  if (!props || Object.keys(props).length === 0) return null;
  const entries = Object.entries(props);
  const shown = open ? entries : entries.slice(0, max);
  const hidden = entries.length - shown.length;
  return (
    <span class="chips">
      {shown.map(([k, v]) => (
        <span class="chip" key={k}>
          <span class="chip-k">{k}</span>
          <span class="chip-v">{fmtVal(v)}</span>
        </span>
      ))}
      {!open && hidden > 0 && (
        <button
          class="chip chip-more"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          +{hidden}
        </button>
      )}
      {open && entries.length > max && (
        <button
          class="chip chip-more"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          less
        </button>
      )}
    </span>
  );
}
