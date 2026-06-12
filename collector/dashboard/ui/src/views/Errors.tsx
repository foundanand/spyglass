import { useEffect, useState } from "preact/hooks";

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

interface ErrorsProps {
  onOpenIncident: (id: number) => void;
}

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function StackRow({ stack }: { stack?: unknown }) {
  const [open, setOpen] = useState(false);
  if (!stack || typeof stack !== "string") return null;
  return (
    <>
      <button class="stack-toggle" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {open ? "▲ hide" : "▼ stack"}
      </button>
      {open && <pre class="stack-trace">{stack}</pre>}
    </>
  );
}

export function Errors({ onOpenIncident }: ErrorsProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");
  const [typeFilter, setTypeFilter] = useState<"error" | "bug_report" | "">("error");

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (typeFilter) params.set("type", typeFilter);
      if (filterUser) params.set("user", filterUser);
      const res = await fetch(`/v1/query/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { events: Event[] };
      setEvents(d.events ?? []);
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filterUser, typeFilter]);

  return (
    <div>
      <h2>Errors &amp; Reports</h2>
      <div class="toolbar">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter((e.target as HTMLSelectElement).value as typeof typeFilter)}
        >
          <option value="error">errors</option>
          <option value="bug_report">bug reports</option>
          <option value="">both</option>
        </select>
        <input
          placeholder="filter by user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <button onClick={load}>Refresh</button>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {fetchError && <div style="color:var(--red);margin-bottom:1rem">{fetchError}</div>}
      <p class="muted" style="font-size:12px;margin-bottom:8px">Click any row to open the incident view</p>
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>type</th>
            <th>user</th>
            <th>message</th>
            <th>source</th>
            <th>session</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && !loading && (
            <tr><td colSpan={6} class="empty">no events — throw something or submit a report</td></tr>
          )}
          {events.map((e) => (
            <tr
              key={e.id}
              class={`row-clickable ${e.type === "bug_report" ? "row-bug_report" : "row-error"}`}
              onClick={() => onOpenIncident(e.id)}
              title="Open incident view"
            >
              <td class="ts">{fmtTs(e.ts)}</td>
              <td><span class={`badge badge-${e.type}`}>{e.type === "bug_report" ? "report" : "error"}</span></td>
              <td>{e.user_id}</td>
              <td class="err-msg">
                <span class="err-name">{e.name}</span>
                {e.type === "error" && <StackRow stack={e.props?.stack} />}
                {e.type === "bug_report" && e.props?.severity && (
                  <span class="severity-inline">{String(e.props.severity)}</span>
                )}
              </td>
              <td class="ts">{String(e.props?.source ?? e.url ?? "")}</td>
              <td class="ts" title={e.session_id}>{e.session_id.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
