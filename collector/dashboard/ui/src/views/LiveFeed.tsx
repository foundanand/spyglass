import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { StatTile, StatStrip } from "../components/StatTile.js";
import { PropsChips } from "../components/PropsChips.js";

interface Event {
  id: number;
  ts: number;
  app: string;
  user_id: string;
  session_id: string;
  type: string;
  name: string;
  url?: string;
  props?: Record<string, unknown>;
}

interface LiveFeedProps {
  onOpenIncident: (id: number) => void;
}

const TYPE_BADGES: Record<string, string> = {
  event: "badge-event",
  pageview: "badge-pageview",
  error: "badge-error",
  network: "badge-network",
  bug_report: "badge-bug_report",
};

const SEG_OPTIONS: { value: string; label: string; color?: string }[] = [
  { value: "", label: "all" },
  { value: "event", label: "event", color: "var(--c-event)" },
  { value: "pageview", label: "pageview", color: "var(--c-pageview)" },
  { value: "error", label: "error", color: "var(--c-error)" },
  { value: "network", label: "network", color: "var(--c-network)" },
  { value: "bug_report", label: "report", color: "var(--c-bug)" },
];

// number of table columns (time, type, user, name, url, props, chevron)
const COL_COUNT = 7;

function fmtTs(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Bucket events into per-minute counts for a compact sparkline.
function minuteBuckets(events: Event[]): number[] {
  if (events.length === 0) return [];
  const buckets = new Map<number, number>();
  for (const e of events) {
    const m = Math.floor(e.ts / 60000);
    buckets.set(m, (buckets.get(m) ?? 0) + 1);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => buckets.get(k) ?? 0);
}

export function LiveFeed({ onOpenIncident }: LiveFeedProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterApp, setFilterApp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const lastIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const params = new URLSearchParams();
        if (filterUser) params.set("user", filterUser);
        if (filterType) params.set("type", filterType);
        if (filterApp) params.set("app", filterApp);
        params.set("limit", "200");

        const res = await fetch(`/v1/query/events?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { events: Event[] };
        if (!cancelled) {
          const prevTop = lastIdRef.current;
          const list = data.events ?? [];
          setEvents(list);
          setError(null);
          // Flash only rows newer than the previous top id; skip the very
          // first load (prevTop === 0) so we don't flash the whole table.
          const fresh = new Set<number>();
          if (prevTop > 0) {
            for (const ev of list) {
              if (ev.id > prevTop) fresh.add(ev.id);
            }
          }
          setNewIds(fresh);
          if (list.length) {
            lastIdRef.current = list[0]?.id ?? 0;
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    poll();
    const timer = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [filterUser, filterType, filterApp]);

  const isIncidentable = (type: string) => type === "error" || type === "bug_report";

  const userCount = new Set(events.map((e) => e.user_id)).size;
  const errorCount = events.filter((e) => isIncidentable(e.type)).length;
  const spark = minuteBuckets(events);

  return (
    <div>
      <h2>
        Live feed{" "}
        {error
          ? <span class="muted">· paused</span>
          : <span class="live-tag"><span class="live-dot" /> live</span>}
      </h2>

      <StatStrip>
        <StatTile label="events · shown" value={events.length} spark={spark} accent="event" />
        <StatTile label="active users" value={userCount} accent="pageview" />
        <StatTile label="errors" value={errorCount} accent="error" />
      </StatStrip>

      <div class="toolbar">
        <input
          placeholder="user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <div class="seg">
          {SEG_OPTIONS.map((o) => (
            <button
              key={o.value}
              class={`seg-btn${filterType === o.value ? " active" : ""}`}
              onClick={() => setFilterType(o.value)}
            >
              {o.color && <span class="seg-dot" style={`background:${o.color}`} />}
              {o.label}
            </button>
          ))}
        </div>
        <input
          placeholder="app"
          value={filterApp}
          onInput={(e) => setFilterApp((e.target as HTMLInputElement).value)}
        />
      </div>
      {error && <div style="color:var(--red);margin-bottom:1rem">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>type</th>
            <th>user</th>
            <th>name</th>
            <th>url</th>
            <th>props</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && (
            <tr>
              <td colSpan={COL_COUNT}>
                <div class="empty-state">
                  <Icon name="inbox" size={28} />
                  <p>no events yet — run the SDK and start capturing</p>
                </div>
              </td>
            </tr>
          )}
          {events.map((e) => {
            const clickable = isIncidentable(e.type);
            const cls = [
              clickable ? "row-clickable" : "",
              newIds.has(e.id) ? "row-new" : "",
            ].filter(Boolean).join(" ");
            return (
              <tr
                key={e.id}
                class={cls}
                onClick={clickable ? () => onOpenIncident(e.id) : undefined}
                title={clickable ? "Open incident view" : undefined}
              >
                <td class="ts">{fmtTs(e.ts)}</td>
                <td><span class={`badge ${TYPE_BADGES[e.type] ?? "badge-event"}`}>{e.type}</span></td>
                <td>
                  <span style="display:flex;align-items:center;gap:6px">
                    <Avatar id={e.user_id} size={18} />
                    {e.user_id}
                  </span>
                </td>
                <td>{e.name}</td>
                <td class="muted">{e.url ?? ""}</td>
                <td class="props"><PropsChips props={e.props} max={3} /></td>
                {clickable
                  ? <td class="row-chevron"><Icon name="chevron-right" /></td>
                  : <td class="row-chevron" />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
