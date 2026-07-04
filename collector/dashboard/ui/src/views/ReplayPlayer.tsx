import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "rrweb/dist/style.css";
import { createReplaySurface, type Marker, type ReplayHandle } from "./replaySurface";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { RelTime } from "../components/RelTime.js";
import { SkeletonRows } from "../components/Skeleton.js";

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
  event: "var(--c-event)", pageview: "var(--c-pageview)", error: "var(--c-error)",
  network: "var(--c-network)", bug_report: "var(--c-bug)",
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
  for (let i = 0; i < items.length; i++) { if (items[i].ts <= nowTs) idx = i; else break; }
  return idx;
}

function markersFromEvents(events: SpyEvent[], firstTs: number): Marker[] {
  const out: Marker[] = [];
  for (const e of events) {
    const offset = e.ts - firstTs;
    if (offset < 0) continue;
    if (e.type === "error") out.push({ offset, kind: "error", label: `error: ${e.name}` });
    else if (e.type === "bug_report") out.push({ offset, kind: "bug", label: `report: ${e.name}` });
    else if (e.type === "pageview") out.push({ offset, kind: "pageview", label: e.name || e.url || "pageview" });
  }
  return out;
}

function InspectorConsole({
  logs, nowIdx, onSeek,
}: { logs: ConsoleLine[]; nowIdx: number; onSeek: (ts: number) => void }) {
  const [level, setLevel] = useState("");
  if (logs.length === 0) return <p class="empty">No console output in this replay</p>;
  const shown = level ? logs.filter((l) => l.level === level) : logs;
  return (
    <>
      <div class="console-filters" style="padding:0.4rem 0.75rem;border-bottom:1px solid var(--border)">
        <button class={`seg-btn${level === "" ? " active" : ""}`} onClick={() => setLevel("")}>all</button>
        {["log", "warn", "error"].map((lv) => (
          <button key={lv} class={`seg-btn${level === lv ? " active" : ""}`} onClick={() => setLevel(lv)}>{lv}</button>
        ))}
      </div>
      <div class="console-lines">
        {shown.map((l) => {
          const gi = logs.indexOf(l);
          return (
            <div
              key={gi}
              class={`console-line level-${l.level}${gi === nowIdx ? " now" : ""}`}
              onClick={() => onSeek(l.ts)}
              title="Jump to this moment"
            >
              <span class="console-ts">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</span>
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
  net, nowIdx, onSeek,
}: { net: SpyEvent[]; nowIdx: number; onSeek: (ts: number) => void }) {
  if (net.length === 0) return <p class="empty">No network requests captured</p>;
  const starts = net.map((e) => e.ts);
  const ends = net.map((e) => e.ts + (Number(e.props?.duration_ms) || 0));
  const winStart = Math.min(...starts);
  const span = Math.max(1, Math.max(...ends) - winStart);
  return (
    <div>
      {net.map((e, i) => {
        const method = String(e.props?.method ?? "GET");
        const status = Number(e.props?.status ?? 0);
        const dur = Number(e.props?.duration_ms ?? 0);
        const left = ((e.ts - winStart) / span) * 100;
        const width = Math.max(2, (dur / span) * 100);
        const statusClass = status >= 500 ? "status-5xx" : status >= 400 ? "status-4xx" : status >= 300 ? "status-3xx" : "status-2xx";
        const barColor = status >= 400 ? "var(--c-error)" : "var(--accent)";
        return (
          <div
            key={i}
            class={`insp-net-row${i === nowIdx ? " now" : ""}`}
            onClick={() => onSeek(e.ts)}
            title="Jump to this moment"
          >
            <span class="http-method">{method}</span>
            <span class="insp-net-url" title={e.name}>{e.name}</span>
            <span class={`status-badge ${statusClass}`}>{status || "—"}</span>
            <div class="insp-net-track">
              <div class="insp-net-bar" style={`left:${left}%;width:${width}%;background:${barColor}`} />
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

function InspectorEvents({
  events, nowIdx, onSeek,
}: { events: SpyEvent[]; nowIdx: number; onSeek: (ts: number) => void }) {
  if (events.length === 0) return <p class="empty">No events in this session</p>;
  return (
    <div>
      {events.map((e, i) => (
        <div
          key={e.id}
          class={`insp-ev-row${i === nowIdx ? " now" : ""}`}
          onClick={() => onSeek(e.ts)}
          title="Jump to this moment"
        >
          <span class="insp-ev-time">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
          <span class="insp-ev-dot" style={`background:${DOT_COLOR[e.type] ?? "var(--muted)"}`} />
          <span class="insp-ev-name">{e.name || e.url || e.type}</span>
        </div>
      ))}
    </div>
  );
}

export function ReplayPlayer({ initialSessionId }: { initialSessionId?: string } = {}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLine[]>([]);
  const [events, setEvents] = useState<SpyEvent[]>([]);
  const [tab, setTab] = useState<Tab>("console");
  const [nowTs, setNowTs] = useState(0);
  const [nowIdx, setNowIdx] = useState(-1);
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReplayHandle | null>(null);
  const firstTsRef = useRef(0);
  const logsRef = useRef<ConsoleLine[]>([]);

  useEffect(() => {
    fetch("/v1/query/sessions")
      .then((r) => r.json())
      .then((d) => {
        const list: Session[] = d.sessions ?? [];
        setSessions(list);
        if (initialSessionId) {
          const s = list.find((x) => x.session_id === initialSessionId);
          if (s) void openSession(s);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (errorsOnly && !(s.error_count && s.error_count > 0)) return false;
      if (q && !(s.user_id.toLowerCase().includes(q) || s.app.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [sessions, search, errorsOnly]);

  const net = useMemo(() => events.filter((e) => e.type === "network"), [events]);
  const netNowIdx = useMemo(() => lastIdxLe(net, nowTs), [net, nowTs]);
  const evNowIdx = useMemo(() => lastIdxLe(events, nowTs), [events, nowTs]);

  async function openSession(session: Session) {
    if (loading) return;
    setSelected(session);
    setLoading(true);
    setConsoleLogs([]);
    setEvents([]);
    setNowIdx(-1);
    setNowTs(0);
    setTab("console");

    try {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* noop */ }
        playerRef.current = null;
      }
      if (playerContainerRef.current) playerContainerRef.current.innerHTML = "";

      const manifest = await fetch(`/v1/sessions/${session.session_id}/replay`).then((r) => r.json());
      const chunks: ChunkInfo[] = manifest.chunks ?? [];
      if (chunks.length === 0) {
        setLoading(false);
        return;
      }

      const allEvents: unknown[] = [];
      const logs: ConsoleLine[] = [];
      for (const chunk of chunks) {
        const evts: unknown[] = await fetch(chunk.path).then((r) => r.json());
        for (const ev of evts) {
          allEvents.push(ev);
          const e = ev as Record<string, unknown>;
          if (e.type === PLUGIN_EVENT && (e.data as Record<string, unknown>)?.plugin === CONSOLE_PLUGIN) {
            const p = (e.data as Record<string, unknown>).payload as Record<string, unknown>;
            logs.push({
              ts: e.timestamp as number,
              level: (p?.level as string) ?? "log",
              payload: Array.isArray(p?.payload) ? p.payload : [],
            });
          }
        }
      }

      logs.sort((a, b) => a.ts - b.ts);
      logsRef.current = logs;
      setConsoleLogs(logs);

      if (playerContainerRef.current && allEvents.length > 0) {
        const first = allEvents[0] as Record<string, unknown>;
        const firstTs = (first?.timestamp as number) ?? 0;
        firstTsRef.current = firstTs;

        playerRef.current = createReplaySurface(playerContainerRef.current, allEvents);

        // Sync inspector panes to playback position.
        playerRef.current.onTimeUpdate((offset) => {
          const absTs = firstTs + offset;
          setNowTs((prev) => (prev === absTs ? prev : absTs));
          const ls = logsRef.current;
          let idx = -1;
          for (let i = 0; i < ls.length; i++) { if (ls[i].ts <= absTs) idx = i; else break; }
          setNowIdx((prev) => (prev === idx ? prev : idx));
        });

        // Events feed markers (timeline) + the Network/Events inspector tabs.
        try {
          const evs: SpyEvent[] = await fetch(
            `/v1/query/events?session=${encodeURIComponent(session.session_id)}&limit=500`,
          ).then((r) => r.json()).then((d) => d.events ?? []);
          evs.sort((a, b) => a.ts - b.ts);
          setEvents(evs);
          playerRef.current.setMarkers(markersFromEvents(evs, firstTs));
        } catch { /* markers/tabs are best-effort */ }
      }
    } catch (err) {
      console.error("replay load error", err);
    } finally {
      setLoading(false);
    }
  }

  const seekToTs = (ts: number) => playerRef.current?.goto(ts - firstTsRef.current);

  return (
    <div class="replay-root">
      <div class="sessions-sidebar">
        <h2><Icon name="play" /> Sessions</h2>
        <div class="sidebar-filters">
          <input
            style="flex:1;min-width:0"
            placeholder="filter user / app"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <button
            class={`rr-toggle${errorsOnly ? " active" : ""}`}
            onClick={() => setErrorsOnly((v) => !v)}
            title="Only sessions with errors"
          >
            <Icon name="error" /> errors
          </button>
        </div>
        {sessions.length === 0 && (
          <div class="empty-state"><Icon name="play" size={26} /><p>No sessions yet</p></div>
        )}
        {filtered.map((s) => {
          const dur = s.last_seen - s.started_at;
          return (
            <div
              key={s.session_id}
              class={`session-item${selected?.session_id === s.session_id ? " active" : ""}`}
              onClick={() => openSession(s)}
            >
              <Avatar id={s.user_id} size={26} />
              <div class="session-body">
                <span class="session-user">{s.user_id}</span>
                <span class="session-meta"><RelTime ts={s.last_seen} /> · {s.app}</span>
                <div class="session-badges">
                  <span class="mini-badge dur"><Icon name="clock" size={10} /> {fmtDur(dur)}</span>
                  {s.error_count ? <span class="mini-badge err"><Icon name="error" size={10} /> {s.error_count}</span> : null}
                  <span class="session-chunks">{s.chunk_count} chunk{s.chunk_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div class="replay-main">
        {!selected && (
          <div class="empty-state"><Icon name="play" size={30} /><p>Select a session to watch its replay</p></div>
        )}
        {selected && (
          <>
            <div class="replay-header">
              <Avatar id={selected.user_id} size={24} />
              <strong>{selected.user_id}</strong>
              <span class="ts">{new Date(selected.started_at).toLocaleString()}</span>
              {loading && <span class="live-tag"><span class="live-dot" /> loading</span>}
            </div>

            <div class="replay-workspace">
              <div class="replay-stage-col">
                {loading && !consoleLogs.length && <SkeletonRows rows={3} />}
                <div ref={playerContainerRef} class="player-container" />
              </div>

              <div class="replay-inspector">
                <div class="inspector-tabs" role="tablist">
                  <button class={`inspector-tab${tab === "console" ? " active" : ""}`} role="tab" aria-selected={tab === "console"} onClick={() => setTab("console")}>
                    <Icon name="network" size={13} /> Console <span class="tab-count">{consoleLogs.length}</span>
                  </button>
                  <button class={`inspector-tab${tab === "network" ? " active" : ""}`} role="tab" aria-selected={tab === "network"} onClick={() => setTab("network")}>
                    <Icon name="network" size={13} /> Network <span class="tab-count">{net.length}</span>
                  </button>
                  <button class={`inspector-tab${tab === "events" ? " active" : ""}`} role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}>
                    <Icon name="clock" size={13} /> Events <span class="tab-count">{events.length}</span>
                  </button>
                </div>
                <div class="inspector-body">
                  {tab === "console" && <InspectorConsole logs={consoleLogs} nowIdx={nowIdx} onSeek={seekToTs} />}
                  {tab === "network" && <InspectorNetwork net={net} nowIdx={netNowIdx} onSeek={seekToTs} />}
                  {tab === "events" && <InspectorEvents events={events} nowIdx={evNowIdx} onSeek={seekToTs} />}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
