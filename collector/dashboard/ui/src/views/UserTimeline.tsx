import { useEffect, useState } from "preact/hooks";

interface UserSummary {
  user_id: string;
  app: string;
  last_seen: number;
  session_count: number;
}

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
  return new Date(ms).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString();
}

const TYPE_COLOR: Record<string, string> = {
  error: "row-error",
  network: "row-network",
  pageview: "row-pageview",
  event: "row-event",
  bug_report: "row-bug",
};

const BADGE: Record<string, string> = {
  event: "badge-event",
  pageview: "badge-pageview",
  error: "badge-error",
  network: "badge-network",
  bug_report: "badge-bug_report",
};

function NetworkDetail({ props }: { props?: Record<string, unknown> }) {
  if (!props) return null;
  const { method, status, duration_ms } = props;
  const statusClass = Number(status) >= 400 ? "status-error" : Number(status) >= 300 ? "status-warn" : "status-ok";
  return (
    <span class="network-detail">
      <span class="http-method">{String(method ?? "")}</span>
      <span class={`http-status ${statusClass}`}>{String(status ?? "")}</span>
      <span class="http-dur">{String(duration_ms ?? "")}ms</span>
    </span>
  );
}

function ErrorDetail({ props }: { props?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  if (!props?.stack) return null;
  return (
    <span class="error-detail">
      <button class="stack-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▲ hide stack" : "▼ stack"}
      </button>
      {open && <pre class="stack-trace">{String(props.stack)}</pre>}
    </span>
  );
}

function groupBySessions(events: Event[]): Map<string, Event[]> {
  const m = new Map<string, Event[]>();
  for (const e of events) {
    const arr = m.get(e.session_id) ?? [];
    arr.push(e);
    m.set(e.session_id, arr);
  }
  // Sort each session's events chronologically (oldest first).
  for (const arr of m.values()) arr.sort((a, b) => a.ts - b.ts);
  return m;
}

export function UserTimeline() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selected, setSelected] = useState<UserSummary | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/v1/query/users?limit=100")
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  async function selectUser(u: UserSummary) {
    setSelected(u);
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ user: u.user_id, limit: "500" });
      const res = await fetch(`/v1/query/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { events: Event[] };
      // Sort all events chronologically for display.
      setEvents((d.events ?? []).sort((a, b) => a.ts - b.ts));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const sessionGroups = groupBySessions(events);
  // Sessions ordered newest-first (by max ts in that session).
  const sessionIds = [...sessionGroups.keys()].sort((a, b) => {
    const aMax = Math.max(...(sessionGroups.get(a)?.map((e) => e.ts) ?? [0]));
    const bMax = Math.max(...(sessionGroups.get(b)?.map((e) => e.ts) ?? [0]));
    return bMax - aMax;
  });

  return (
    <div class="timeline-root">
      <div class="timeline-sidebar">
        <h2>Users</h2>
        {users.length === 0 && <p class="empty">No users yet</p>}
        {users.map((u) => (
          <div
            key={`${u.user_id}:${u.app}`}
            class={`timeline-user-item${selected?.user_id === u.user_id && selected.app === u.app ? " active" : ""}`}
            onClick={() => selectUser(u)}
          >
            <span class="tl-user">{u.user_id}</span>
            <span class="tl-meta">{u.app} · {u.session_count} session{u.session_count !== 1 ? "s" : ""}</span>
            <span class="tl-meta">{fmtDate(u.last_seen)}</span>
          </div>
        ))}
      </div>

      <div class="timeline-main">
        {!selected && <p class="empty">Select a user to view their session timeline</p>}
        {selected && (
          <>
            <div class="tl-header">
              <strong>{selected.user_id}</strong>
              <span class="ts">{selected.app}</span>
              {loading && <span class="ts">Loading…</span>}
            </div>
            {error && <div class="tl-error">{error}</div>}
            {!loading && events.length === 0 && !error && (
              <p class="empty">No events recorded for this user</p>
            )}
            {sessionIds.map((sid) => {
              const ses = sessionGroups.get(sid)!;
              const start = ses[0]?.ts ?? 0;
              const end = ses[ses.length - 1]?.ts ?? 0;
              const errorCount = ses.filter((e) => e.type === "error").length;
              return (
                <div key={sid} class="tl-session">
                  <div class="tl-session-header">
                    <span class="tl-session-id" title={sid}>{sid.slice(0, 12)}…</span>
                    <span class="ts">{fmtTs(start)} – {fmtTs(end)}</span>
                    {errorCount > 0 && (
                      <span class="tl-err-badge">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  <table class="tl-table">
                    <tbody>
                      {ses.map((e) => (
                        <tr key={e.id} class={TYPE_COLOR[e.type] ?? ""}>
                          <td class="ts tl-ts">{fmtTs(e.ts)}</td>
                          <td>
                            <span class={`badge ${BADGE[e.type] ?? "badge-event"}`}>{e.type}</span>
                          </td>
                          <td class="tl-name">
                            {e.name}
                            {e.type === "network" && <NetworkDetail props={e.props} />}
                            {e.type === "error" && <ErrorDetail props={e.props} />}
                          </td>
                          <td class="tl-url ts">{e.url ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
