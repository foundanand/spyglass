import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "rrweb/dist/style.css";
// Type-only: erased at compile time, so importing these costs no runtime
// dependency on rrweb. The surface itself is loaded on demand below — it pulls
// in the whole replay engine (81% of the dashboard bundle before this split).
import type { Marker, ReplayHandle } from "./replaySurface";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { RelTime } from "../components/RelTime.js";
import { rowButton } from "../components/rowProps.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { applyRange, type TimeRange } from "../range.js";

interface Session {
  session_id: string;
  app: string;
  user_id: string;
  started_at: number;
  last_seen: number;
  chunk_count: number;
  event_count?: number;
  error_count?: number;
}

interface ChunkInfo {
  seq: number;
  ts: number;
  path: string;
}

interface ConsoleLine {
  ts: number;
  level: string;
  payload: unknown[];
}

interface SpyEvent {
  id: number;
  ts: number;
  type: string;
  name: string;
  url?: string;
  props?: Record<string, unknown>;
}

type Tab = "console" | "network" | "events";

// rrweb EventType.Plugin === 6
const PLUGIN_EVENT = 6;
const CONSOLE_PLUGIN = "@rrweb/rrweb-plugin-console-record";

const DOT_COLOR: Record<string, string> = {
  event: "var(--c-event)",
  pageview: "var(--c-pageview)",
  error: "var(--c-error)",
  network: "var(--c-network)",
  bug_report: "var(--c-bug)",
};

function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtHttp(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Index of the last item with ts <= nowTs (for the "now" row highlight).
function lastIdxLe(items: { ts: number }[], nowTs: number): number {
  let idx = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].ts <= nowTs) idx = i;
    else break;
  }
  return idx;
}

function markersFromEvents(events: SpyEvent[], firstTs: number): Marker[] {
  const out: Marker[] = [];
  for (const e of events) {
    const offset = e.ts - firstTs;
    if (offset < 0) continue;
    if (e.type === "error") out.push({ offset, kind: "error", label: `error: ${e.name}` });
    else if (e.type === "bug_report") out.push({ offset, kind: "bug", label: `report: ${e.name}` });
    else if (e.type === "pageview")
      out.push({ offset, kind: "pageview", label: e.name || e.url || "pageview" });
  }
  return out;
}

function InspectorConsole({
  logs,
  nowIdx,
  onSeek,
}: {
  logs: ConsoleLine[];
  nowIdx: number;
  onSeek: (ts: number) => void;
}) {
  const [level, setLevel] = useState("");
  if (logs.length === 0) return <p class="empty">No console output in this replay</p>;
  const shown = level ? logs.filter((l) => l.level === level) : logs;
  return (
    <>
      <div
        class="console-filters"
        style="padding:0.4rem 0.75rem;border-bottom:1px solid var(--border)"
      >
        <button class={`seg-btn${level === "" ? " active" : ""}`} onClick={() => setLevel("")}>
          all
        </button>
        {["log", "warn", "error"].map((lv) => (
          <button
            key={lv}
            class={`seg-btn${level === lv ? " active" : ""}`}
            onClick={() => setLevel(lv)}
          >
            {lv}
          </button>
        ))}
      </div>
      <div class="console-lines">
        {shown.map((l) => {
          const gi = logs.indexOf(l);
          return (
            <div
              key={gi}
              class={`console-line level-${l.level}${gi === nowIdx ? " now" : ""}`}
              title="Jump to this moment"
              {...rowButton(
                () => onSeek(l.ts),
                `Jump to console ${l.level} at ${new Date(l.ts).toLocaleTimeString([], { hour12: false })}`,
              )}
            >
              <span class="console-ts">
                {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span class="console-level">{l.level}</span>
              <span class="console-msg">
                {l.payload.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function InspectorNetwork({
  net,
  total,
  query,
  onQuery,
  nowTs,
  onSeek,
}: {
  net: SpyEvent[];
  total: number;
  query: string;
  onQuery: (q: string) => void;
  nowTs: number;
  onSeek: (ts: number) => void;
}) {
  if (total === 0) return <p class="empty">No network requests captured</p>;
  const nowIdx = lastIdxLe(net, nowTs);
  const starts = net.map((e) => e.ts);
  const ends = net.map((e) => e.ts + (Number(e.props?.duration_ms) || 0));
  const winStart = starts.length ? Math.min(...starts) : 0;
  const span = Math.max(1, (ends.length ? Math.max(...ends) : 0) - winStart);
  return (
    <div>
      <div class="insp-filter">
        <input
          type="search"
          class="insp-filter-input"
          placeholder="Search URL, method, status…"
          aria-label="Search network requests"
          value={query}
          onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
        />
        {query.trim() !== "" && (
          <div class="insp-filter-status" role="status">
            {net.length} of {total}
            <button type="button" class="insp-filter-clear" onClick={() => onQuery("")}>
              clear
            </button>
          </div>
        )}
      </div>
      {net.length === 0 && <p class="empty">No requests match “{query.trim()}”</p>}
      {net.map((e, i) => {
        const method = String(e.props?.method ?? "GET");
        const status = Number(e.props?.status ?? 0);
        const dur = Number(e.props?.duration_ms ?? 0);
        const left = ((e.ts - winStart) / span) * 100;
        const width = Math.max(2, (dur / span) * 100);
        const statusClass =
          status >= 500
            ? "status-5xx"
            : status >= 400
              ? "status-4xx"
              : status >= 300
                ? "status-3xx"
                : "status-2xx";
        const barColor = status >= 400 ? "var(--c-error)" : "var(--accent)";
        return (
          <div
            key={e.id ?? i}
            class={`insp-net-row${i === nowIdx ? " now" : ""}`}
            title="Jump to this moment"
            {...rowButton(
              () => onSeek(e.ts),
              `Jump to ${method} ${e.name}, status ${status || "unknown"}`,
            )}
          >
            <span class="http-method">{method}</span>
            <span class="insp-net-url" title={e.name}>
              {e.name}
            </span>
            <span class={`status-badge ${statusClass}`}>{status || "—"}</span>
            <div class="insp-net-track" aria-hidden="true">
              <div
                class="insp-net-bar"
                style={`left:${left}%;width:${width}%;background:${barColor}`}
              />
            </div>
            <span class="insp-net-meta">
              <span class="http-dur">{dur ? fmtHttp(dur) : "—"}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  event: "events",
  pageview: "pages",
  error: "errors",
  network: "network",
  bug_report: "reports",
};

// Everything a person might type to find an event: its name, URL, type and
// props (as text, so "invoice" or "500" or a prop value all match).
function eventHaystack(e: SpyEvent): string {
  let props = "";
  if (e.props) {
    try {
      props = JSON.stringify(e.props);
    } catch {
      /* unserialisable props are simply not searchable */
    }
  }
  return `${e.name} ${e.url ?? ""} ${e.type} ${props}`.toLowerCase();
}

function InspectorEvents({
  events,
  shown,
  nowTs,
  onSeek,
  query,
  onQuery,
  types,
  onToggleType,
  onClear,
  truncated,
}: {
  events: SpyEvent[];
  shown: SpyEvent[];
  nowTs: number;
  onSeek: (ts: number) => void;
  query: string;
  onQuery: (q: string) => void;
  types: Set<string>;
  onToggleType: (t: string) => void;
  onClear: () => void;
  truncated: boolean;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [events]);

  if (events.length === 0) return <p class="empty">No events in this session</p>;

  const filtering = query.trim() !== "" || types.size > 0;
  const nowIdx = lastIdxLe(shown, nowTs);

  return (
    <div>
      <div class="insp-filter">
        <input
          type="search"
          class="insp-filter-input"
          placeholder="Search events, URLs, props…"
          aria-label="Search events"
          value={query}
          onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
        />
        <div class="insp-filter-chips" role="group" aria-label="Filter by event type">
          {[...counts.entries()].map(([t, n]) => (
            <button
              key={t}
              type="button"
              class={`seg-btn${types.has(t) ? " active" : ""}`}
              aria-pressed={types.has(t)}
              onClick={() => onToggleType(t)}
            >
              <span class="insp-ev-dot" style={`background:${DOT_COLOR[t] ?? "var(--muted)"}`} />{" "}
              {TYPE_LABEL[t] ?? t} <span class="seg-count">{n}</span>
            </button>
          ))}
        </div>
        {filtering && (
          <div class="insp-filter-status" role="status">
            {shown.length} of {events.length}
            <button type="button" class="insp-filter-clear" onClick={onClear}>
              clear
            </button>
          </div>
        )}
      </div>
      {truncated && (
        <p class="note">
          Showing the first {events.length.toLocaleString()} events — this session has more.
        </p>
      )}
      {shown.length === 0 && <p class="empty">No events match these filters</p>}
      {shown.map((e, i) => (
        <div
          key={e.id}
          class={`insp-ev-row${i === nowIdx ? " now" : ""}`}
          title="Jump to this moment"
          {...rowButton(() => onSeek(e.ts), `Jump to ${e.type} ${e.name || e.url || ""}`)}
        >
          <span class="insp-ev-time">
            {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
          </span>
          <span class="insp-ev-dot" style={`background:${DOT_COLOR[e.type] ?? "var(--muted)"}`} />
          <span class="insp-ev-name">{e.name || e.url || e.type}</span>
        </div>
      ))}
    </div>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText || "request failed"}`.trim());
  return (await r.json()) as T;
}

// Replays are many small chunks; fetching them one at a time made a 23-chunk
// session wait on 23 round trips. A few in flight at once, order preserved.
const CHUNK_CONCURRENCY = 6;
// The events endpoint caps a page at 500 and hands back a cursor for the rest.
const EVENT_PAGE = 500;
const EVENT_MAX_PAGES = 20;

export function ReplayPlayer({
  initialSessionId,
  range,
}: {
  initialSessionId?: string;
  range: TimeRange;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "error">("loading");
  const [sessionsError, setSessionsError] = useState("");
  const [selected, setSelected] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [eventsError, setEventsError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLine[]>([]);
  const [events, setEvents] = useState<SpyEvent[]>([]);
  const [tab, setTab] = useState<Tab>("console");
  const [nowTs, setNowTs] = useState(0);
  const [nowIdx, setNowIdx] = useState(-1);
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  // Inspector filters live here, not in the tab components: switching tabs
  // unmounts them, and a filter that evaporates when you look elsewhere is a
  // filter you have to retype.
  const [evQuery, setEvQuery] = useState("");
  const [evTypes, setEvTypes] = useState<Set<string>>(new Set());
  const [netQuery, setNetQuery] = useState("");
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReplayHandle | null>(null);
  const firstTsRef = useRef(0);
  const logsRef = useRef<ConsoleLine[]>([]);
  // Bumped on every openSession; a load that finds it has moved on stops quietly,
  // which is what lets a person click another session mid-load.
  const loadToken = useRef(0);

  function loadSessions() {
    setSessionsState("loading");
    const params = new URLSearchParams();
    applyRange(params, range);
    getJson<{ sessions?: Session[] }>(`/v1/query/sessions?${params.toString()}`)
      .then((d) => {
        const list: Session[] = d.sessions ?? [];
        setSessions(list);
        setSessionsState("ready");
        if (initialSessionId) {
          const s = list.find((x) => x.session_id === initialSessionId);
          if (s) void openSession(s);
        }
      })
      .catch((err: Error) => {
        setSessionsError(err.message);
        setSessionsState("error");
      });
  }

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (errorsOnly && !(s.error_count && s.error_count > 0)) return false;
      if (q && !(s.user_id.toLowerCase().includes(q) || s.app.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [sessions, search, errorsOnly]);

  const shownEvents = useMemo(() => {
    const q = evQuery.trim().toLowerCase();
    return events.filter(
      (e) => (evTypes.size === 0 || evTypes.has(e.type)) && (!q || eventHaystack(e).includes(q)),
    );
  }, [events, evQuery, evTypes]);

  const allNet = useMemo(() => events.filter((e) => e.type === "network"), [events]);
  const net = useMemo(() => {
    const q = netQuery.trim().toLowerCase();
    if (!q) return allNet;
    return allNet.filter((e) =>
      `${e.props?.method ?? "GET"} ${e.name} ${e.props?.status ?? ""}`.toLowerCase().includes(q),
    );
  }, [allNet, netQuery]);

  // The timeline markers follow the events filter, so "show me only errors"
  // means the scrub bar too, not just the list beside it.
  useEffect(() => {
    playerRef.current?.setMarkers(markersFromEvents(shownEvents, firstTsRef.current));
  }, [shownEvents]);

  // While fullscreen the inspector is out of sight; surface what just happened.
  useEffect(() => {
    if (!playerRef.current) return;
    const real = events.filter((e) => e.type !== "network");
    const i = lastIdxLe(real, nowTs);
    const e = i >= 0 ? real[i] : null;
    playerRef.current.setCaption(e ? `${e.type}: ${e.name || e.url || ""}` : "");
  }, [nowTs, events]);

  async function openSession(session: Session) {
    const token = ++loadToken.current;
    const stale = () => token !== loadToken.current;
    setSelected(session);
    setLoading(true);
    setLoadError("");
    setEventsError(false);
    setTruncated(false);
    setProgress(null);
    setConsoleLogs([]);
    setEvents([]);
    setNowIdx(-1);
    setNowTs(0);
    setTab("console");
    setEvQuery("");
    setEvTypes(new Set());
    setNetQuery("");

    try {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          /* noop */
        }
        playerRef.current = null;
      }
      if (playerContainerRef.current) playerContainerRef.current.innerHTML = "";

      const manifest = await getJson<{ chunks?: ChunkInfo[] }>(
        `/v1/sessions/${session.session_id}/replay`,
      );
      if (stale()) return;
      const chunks: ChunkInfo[] = manifest.chunks ?? [];
      if (chunks.length === 0) {
        setLoadError("This session has no replay recording.");
        return;
      }

      const parts: unknown[][] = new Array(chunks.length);
      let next = 0;
      let done = 0;
      setProgress({ done: 0, total: chunks.length });
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= chunks.length || stale()) return;
          parts[i] = await getJson<unknown[]>(chunks[i].path);
          done++;
          if (!stale()) setProgress({ done, total: chunks.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));
      if (stale()) return;

      const allEvents: unknown[] = parts.flat();
      const logs: ConsoleLine[] = [];
      for (const ev of allEvents) {
        const e = ev as Record<string, unknown>;
        if (
          e.type === PLUGIN_EVENT &&
          (e.data as Record<string, unknown>)?.plugin === CONSOLE_PLUGIN
        ) {
          const p = (e.data as Record<string, unknown>).payload as Record<string, unknown>;
          logs.push({
            ts: e.timestamp as number,
            level: (p?.level as string) ?? "log",
            payload: Array.isArray(p?.payload) ? p.payload : [],
          });
        }
      }

      logs.sort((a, b) => a.ts - b.ts);
      logsRef.current = logs;
      setConsoleLogs(logs);

      if (playerContainerRef.current && allEvents.length > 0) {
        const first = allEvents[0] as Record<string, unknown>;
        const firstTs = (first?.timestamp as number) ?? 0;
        firstTsRef.current = firstTs;

        const { createReplaySurface } = await import("./replaySurface");
        if (stale() || !playerContainerRef.current) return;
        playerRef.current = createReplaySurface(playerContainerRef.current, allEvents);

        // Sync inspector panes to playback position.
        playerRef.current.onTimeUpdate((offset) => {
          const absTs = firstTs + offset;
          setNowTs((prev) => (prev === absTs ? prev : absTs));
          const ls = logsRef.current;
          let idx = -1;
          for (let i = 0; i < ls.length; i++) {
            if (ls[i].ts <= absTs) idx = i;
            else break;
          }
          setNowIdx((prev) => (prev === idx ? prev : idx));
        });

        // Events feed the timeline markers and the Network/Events tabs. Page
        // through the cursor: the endpoint caps one page at 500.
        try {
          const evs: SpyEvent[] = [];
          let cursor = "";
          let more = false;
          for (let page = 0; page < EVENT_MAX_PAGES; page++) {
            const qs =
              `session=${encodeURIComponent(session.session_id)}&limit=${EVENT_PAGE}` +
              (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
            const d = await getJson<{ events?: SpyEvent[]; next?: string }>(
              `/v1/query/events?${qs}`,
            );
            if (stale()) return;
            evs.push(...(d.events ?? []));
            cursor = d.next ?? "";
            more = cursor !== "";
            if (!more) break;
          }
          evs.sort((a, b) => a.ts - b.ts);
          setEvents(evs);
          setTruncated(more);
        } catch {
          // The replay itself is fine; say the side panels are incomplete.
          if (!stale()) setEventsError(true);
        }
      }
    } catch (err) {
      if (!stale()) {
        console.error("replay load error", err);
        setLoadError((err as Error).message || "request failed");
      }
    } finally {
      if (!stale()) {
        setLoading(false);
        setProgress(null);
      }
    }
  }

  const seekToTs = (ts: number) => playerRef.current?.goto(ts - firstTsRef.current);
  const toggleEvType = (t: string) =>
    setEvTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div class="replay-root">
      <div class="sessions-sidebar">
        <h2>
          <Icon name="play" /> Sessions
        </h2>
        <div class="sidebar-filters">
          <input
            style="flex:1;min-width:0"
            placeholder="filter user / app"
            aria-label="Filter sessions by user or app"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <button
            class={`rr-toggle${errorsOnly ? " active" : ""}`}
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((v) => !v)}
            title="Only sessions with errors"
          >
            <Icon name="error" /> errors
          </button>
        </div>
        {sessionsState === "loading" && <SkeletonRows rows={4} />}
        {sessionsState === "error" && (
          <div class="alert" role="alert">
            <span>Couldn’t load sessions ({sessionsError}).</span>
            <button type="button" onClick={loadSessions}>
              Retry
            </button>
          </div>
        )}
        {sessionsState === "ready" && sessions.length === 0 && (
          <div class="empty-state">
            <Icon name="play" size={26} />
            <p>No sessions in this time range</p>
          </div>
        )}
        {sessionsState === "ready" && sessions.length > 0 && filtered.length === 0 && (
          <p class="note">No sessions match these filters.</p>
        )}
        {filtered.map((s) => {
          const dur = s.last_seen - s.started_at;
          const active = selected?.session_id === s.session_id;
          return (
            <div
              key={s.session_id}
              class={`session-item${active ? " active" : ""}`}
              aria-current={active ? "true" : undefined}
              {...rowButton(
                () => openSession(s),
                `Open replay: ${s.user_id}, ${s.app}, ${fmtDur(dur)}${s.error_count ? `, ${s.error_count} errors` : ""}`,
              )}
            >
              <Avatar id={s.user_id} size={26} />
              <div class="session-body">
                <span class="session-user">{s.user_id}</span>
                <span class="session-meta">
                  <RelTime ts={s.last_seen} /> · {s.app}
                </span>
                <div class="session-badges">
                  <span class="mini-badge dur">
                    <Icon name="clock" size={10} /> {fmtDur(dur)}
                  </span>
                  {s.error_count ? (
                    <span class="mini-badge err">
                      <Icon name="error" size={10} /> {s.error_count}
                    </span>
                  ) : null}
                  <span class="session-chunks">
                    {s.chunk_count} chunk{s.chunk_count !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div class="replay-main">
        {!selected && (
          <div class="empty-state">
            <Icon name="play" size={30} />
            <p>Select a session to watch its replay</p>
          </div>
        )}
        {selected && (
          <>
            <div class="replay-header">
              <Avatar id={selected.user_id} size={24} />
              <strong>{selected.user_id}</strong>
              <span class="ts">{new Date(selected.started_at).toLocaleString()}</span>
              {loading && (
                <span class="live-tag" role="status">
                  <span class="live-dot" /> loading
                  {progress && (
                    <span class="rr-progress">
                      {" "}
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </span>
              )}
            </div>

            {loadError && (
              <div class="alert" role="alert">
                <span>Couldn’t load this replay: {loadError}</span>
                <button type="button" onClick={() => openSession(selected)}>
                  Retry
                </button>
              </div>
            )}
            {eventsError && !loadError && (
              <div class="alert" role="alert">
                <span>
                  The replay loaded, but its events couldn’t be fetched, so the Events and Network
                  tabs and the timeline markers are incomplete.
                </span>
                <button type="button" onClick={() => openSession(selected)}>
                  Retry
                </button>
              </div>
            )}

            <div class="replay-workspace">
              <div class="replay-stage-col">
                {loading && !consoleLogs.length && <SkeletonRows rows={3} />}
                <div ref={playerContainerRef} class="player-container" />
                <p class="rr-hint">
                  <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> seek 5s · <kbd>f</kbd>{" "}
                  fullscreen
                </p>
              </div>

              <div class="replay-inspector">
                <div class="inspector-tabs" role="tablist">
                  <button
                    class={`inspector-tab${tab === "console" ? " active" : ""}`}
                    role="tab"
                    aria-selected={tab === "console"}
                    onClick={() => setTab("console")}
                  >
                    <Icon name="network" size={13} /> Console{" "}
                    <span class="tab-count">{consoleLogs.length}</span>
                  </button>
                  <button
                    class={`inspector-tab${tab === "network" ? " active" : ""}`}
                    role="tab"
                    aria-selected={tab === "network"}
                    onClick={() => setTab("network")}
                  >
                    <Icon name="network" size={13} /> Network{" "}
                    <span class="tab-count">{allNet.length}</span>
                  </button>
                  <button
                    class={`inspector-tab${tab === "events" ? " active" : ""}`}
                    role="tab"
                    aria-selected={tab === "events"}
                    onClick={() => setTab("events")}
                  >
                    <Icon name="clock" size={13} /> Events{" "}
                    <span class="tab-count">
                      {events.length}
                      {truncated ? "+" : ""}
                    </span>
                  </button>
                </div>
                <div class="inspector-body">
                  {tab === "console" && (
                    <InspectorConsole logs={consoleLogs} nowIdx={nowIdx} onSeek={seekToTs} />
                  )}
                  {tab === "network" && (
                    <InspectorNetwork
                      net={net}
                      total={allNet.length}
                      query={netQuery}
                      onQuery={setNetQuery}
                      nowTs={nowTs}
                      onSeek={seekToTs}
                    />
                  )}
                  {tab === "events" && (
                    <InspectorEvents
                      events={events}
                      shown={shownEvents}
                      nowTs={nowTs}
                      onSeek={seekToTs}
                      query={evQuery}
                      onQuery={setEvQuery}
                      types={evTypes}
                      onToggleType={toggleEvType}
                      onClear={() => {
                        setEvQuery("");
                        setEvTypes(new Set());
                      }}
                      truncated={truncated}
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
