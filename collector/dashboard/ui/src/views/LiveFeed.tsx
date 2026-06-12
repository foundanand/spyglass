import { useEffect, useRef, useState } from "preact/hooks";

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

function fmtTs(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtProps(props?: Record<string, unknown>) {
  if (!props || Object.keys(props).length === 0) return null;
  return JSON.stringify(props);
}

export function LiveFeed({ onOpenIncident }: LiveFeedProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterApp, setFilterApp] = useState("");
  const [error, setError] = useState<string | null>(null);
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
          setEvents(data.events ?? []);
          setError(null);
          if (data.events?.length) {
            lastIdRef.current = data.events[0]?.id ?? 0;
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

  return (
    <div>
      <h2>Live feed</h2>
      <div class="toolbar">
        <input
          placeholder="user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <select value={filterType} onChange={(e) => setFilterType((e.target as HTMLSelectElement).value)}>
          <option value="">all types</option>
          <option value="event">event</option>
          <option value="pageview">pageview</option>
          <option value="error">error</option>
          <option value="network">network</option>
          <option value="bug_report">bug_report</option>
        </select>
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
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && (
            <tr><td colSpan={6} class="empty">no events — run the SDK and start capturing</td></tr>
          )}
          {events.map((e) => (
            <tr
              key={e.id}
              class={isIncidentable(e.type) ? "row-clickable" : ""}
              onClick={isIncidentable(e.type) ? () => onOpenIncident(e.id) : undefined}
              title={isIncidentable(e.type) ? "Open incident view" : undefined}
            >
              <td class="ts">{fmtTs(e.ts)}</td>
              <td><span class={`badge ${TYPE_BADGES[e.type] ?? "badge-event"}`}>{e.type}</span></td>
              <td>{e.user_id}</td>
              <td>{e.name}</td>
              <td class="muted">{e.url ?? ""}</td>
              <td class="props">{fmtProps(e.props)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
