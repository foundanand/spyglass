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
      <button class="stack-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▲ hide" : "▼ stack"}
      </button>
      {open && <pre class="stack-trace">{stack}</pre>}
    </>
  );
}

export function Errors() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ type: "error", limit: "200" });
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

  useEffect(() => { void load(); }, [filterUser]);

  return (
    <div>
      <h2>Errors</h2>
      <div class="toolbar">
        <input
          placeholder="filter by user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <button onClick={load}>Refresh</button>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {fetchError && <div style="color:var(--red);margin-bottom:1rem">{fetchError}</div>}
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>user</th>
            <th>message</th>
            <th>source</th>
            <th>session</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && !loading && (
            <tr><td colSpan={5} class="empty">no errors — throw something and it'll appear here</td></tr>
          )}
          {events.map((e) => (
            <tr key={e.id} class="row-error">
              <td class="ts">{fmtTs(e.ts)}</td>
              <td>{e.user_id}</td>
              <td class="err-msg">
                <span class="err-name">{e.name}</span>
                <StackRow stack={e.props?.stack} />
              </td>
              <td class="ts">{String(e.props?.source ?? "")}</td>
              <td class="ts" title={e.session_id}>{e.session_id.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
