import { useEffect, useRef, useState } from "preact/hooks";
import "rrweb/dist/style.css";
import { createReplaySurface, type Marker, type ReplayHandle } from "./replaySurface";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { PropsChips } from "../components/PropsChips.js";

interface SpyEvent {
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

interface ReplayCueChunk {
  seq: number;
  ts: number;
  path: string;
}

interface IncidentData {
  event: SpyEvent;
  breadcrumbs: SpyEvent[];
  incident_ts: number;
  session_id: string;
  replay_cue?: { chunks: ReplayCueChunk[] };
}

interface ConsoleLine {
  ts: number;
  level: string;
  payload: unknown[];
}

const PLUGIN_EVENT = 6;
const CONSOLE_PLUGIN = "@rrweb/rrweb-plugin-console-record";

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StackBlock({ stack }: { stack?: unknown }) {
  const [open, setOpen] = useState(false);
  if (!stack || typeof stack !== "string") return null;
  return (
    <div class="stack-block">
      <button class="stack-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▲ hide stack" : "▼ show stack trace"}
      </button>
      {open && <pre class="stack-trace">{stack}</pre>}
    </div>
  );
}

const TYPE_BADGE: Record<string, string> = {
  event: "badge-event", pageview: "badge-pageview", error: "badge-error",
  network: "badge-network", bug_report: "badge-bug_report",
};

function BreadcrumbsTable({
  events, incidentTs, nowTs, onSeek,
}: {
  events: SpyEvent[]; incidentTs: number; nowTs: number; onSeek: (ts: number) => void;
}) {
  const nowRow = lastLe(events, nowTs);
  return (
    <table>
      <thead>
        <tr><th>time</th><th>type</th><th>name / url</th><th>details</th></tr>
      </thead>
      <tbody>
        {events.length === 0 && (<tr><td colSpan={4} class="empty">no breadcrumbs</td></tr>)}
        {events.map((e) => {
          const isIncident = e.ts === incidentTs;
          const isNow = nowTs > 0 && e.ts === nowRow;
          return (
            <tr
              key={e.id}
              class={`row-clickable${isIncident ? " row-error" : ""}${isNow ? " now" : ""}`}
              onClick={() => onSeek(e.ts)}
              title="Jump to this moment"
            >
              <td class="ts">{fmtTs(e.ts)}</td>
              <td><span class={`badge ${TYPE_BADGE[e.type] ?? "badge-event"}`}>{e.type}</span></td>
              <td>{e.name || e.url || "—"}</td>
              <td><PropsChips props={e.props} max={3} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ts of the last breadcrumb at/before nowTs (for the "now" row highlight).
function lastLe(events: SpyEvent[], nowTs: number): number {
  let t = -1;
  for (const e of events) if (e.ts <= nowTs) t = e.ts;
  return t;
}

function NetworkWaterfall({
  events, onSeek, nowTs,
}: {
  events: SpyEvent[]; onSeek: (ts: number) => void; nowTs: number;
}) {
  const net = events.filter((e) => e.type === "network");
  if (net.length === 0) return <p class="empty">no network requests in window</p>;

  // Real waterfall: position each bar by its start offset within the window.
  const starts = net.map((e) => e.ts);
  const ends = net.map((e) => e.ts + (Number(e.props?.duration_ms) || 0));
  const winStart = Math.min(...starts);
  const winEnd = Math.max(...ends);
  const span = Math.max(1, winEnd - winStart);
  const nowRow = lastLe(net, nowTs);

  return (
    <table class="network-table">
      <thead>
        <tr><th>method</th><th>url</th><th>status</th><th>duration</th><th style="width:160px">waterfall</th></tr>
      </thead>
      <tbody>
        {net.map((e, i) => {
          const method = String(e.props?.method ?? "GET");
          const status = Number(e.props?.status ?? 0);
          const dur = Number(e.props?.duration_ms ?? 0);
          const left = ((e.ts - winStart) / span) * 100;
          const width = Math.max(1.5, (dur / span) * 100);
          const statusClass = status >= 500 ? "status-5xx" : status >= 400 ? "status-4xx" : status >= 300 ? "status-3xx" : "status-2xx";
          return (
            <tr key={i} class={`row-clickable${nowTs > 0 && e.ts === nowRow ? " now" : ""}`} onClick={() => onSeek(e.ts)}>
              <td class="ts">{method}</td>
              <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title={e.name}>{e.name}</td>
              <td><span class={`status-badge ${statusClass}`}>{status || "—"}</span></td>
              <td class="ts">{dur ? fmtDuration(dur) : "—"}</td>
              <td>
                <div class="waterfall-track">
                  <div class="waterfall-bar" style={`left:${left}%;width:${width}%`} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConsolePane({
  logs, nowIdx, onSeek,
}: {
  logs: ConsoleLine[]; nowIdx: number; onSeek: (ts: number) => void;
}) {
  if (logs.length === 0) return <p class="empty">no console output in replay</p>;
  return (
    <div class="console-lines">
      {logs.map((l, i) => (
        <div
          key={i}
          class={`console-line level-${l.level}${i === nowIdx ? " now" : ""}`}
          onClick={() => onSeek(l.ts)}
          title="Jump to this moment"
        >
          <span class="console-ts">{new Date(l.ts).toLocaleTimeString()}</span>
          <span class="console-level">{l.level}</span>
          <span class="console-msg">
            {l.payload.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}
          </span>
        </div>
      ))}
    </div>
  );
}

interface IncidentProps {
  eventId: number;
  onBack: () => void;
}

export function Incident({ eventId, onBack }: IncidentProps) {
  const [data, setData] = useState<IncidentData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLine[]>([]);
  const [nowTs, setNowTs] = useState(0);
  const [nowIdx, setNowIdx] = useState(-1);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReplayHandle | null>(null);
  const firstTsRef = useRef(0);
  const logsRef = useRef<ConsoleLine[]>([]);

  useEffect(() => {
    fetch(`/v1/incidents/${eventId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<IncidentData>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) => setFetchError(String(e)));
  }, [eventId]);

  useEffect(() => {
    if (!data?.replay_cue) return;
    void loadReplay(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.session_id]);

  async function loadReplay(incident: IncidentData) {
    setReplayLoading(true);
    setConsoleLogs([]);
    setNowTs(0);
    setNowIdx(-1);

    try {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* noop */ }
        playerRef.current = null;
      }
      if (playerContainerRef.current) playerContainerRef.current.innerHTML = "";

      const manifest = await fetch(`/v1/sessions/${incident.session_id}/replay`).then((r) => r.json());
      const chunks: { seq: number; ts: number; path: string }[] = manifest.chunks ?? [];
      if (chunks.length === 0) {
        setReplayLoading(false);
        return;
      }

      const allEvents: unknown[] = [];
      const logs: ConsoleLine[] = [];
      for (const chunk of chunks) {
        const events: unknown[] = await fetch(chunk.path).then((r) => r.json());
        for (const ev of events) {
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
        const firstEvent = allEvents[0] as Record<string, unknown>;
        const firstTs = (firstEvent?.timestamp as number) ?? 0;
        firstTsRef.current = firstTs;

        playerRef.current = createReplaySurface(playerContainerRef.current, allEvents);

        // Markers: the incident moment + every breadcrumb of interest.
        const markers: Marker[] = [];
        if (firstTs > 0) {
          markers.push({ offset: incident.incident_ts - firstTs, kind: "incident", label: incident.event.name });
          for (const b of incident.breadcrumbs) {
            const offset = b.ts - firstTs;
            if (offset < 0) continue;
            if (b.type === "error") markers.push({ offset, kind: "error", label: b.name });
            else if (b.type === "bug_report") markers.push({ offset, kind: "bug", label: b.name });
            else if (b.type === "pageview") markers.push({ offset, kind: "pageview", label: b.name || b.url || "pageview" });
          }
          playerRef.current.setMarkers(markers);
        }

        // Sync breadcrumb/network/console highlight to playback.
        playerRef.current.onTimeUpdate((offset) => {
          const absTs = firstTs + offset;
          setNowTs((prev) => (prev === absTs ? prev : absTs));
          const ls = logsRef.current;
          let idx = -1;
          for (let i = 0; i < ls.length; i++) { if (ls[i].ts <= absTs) idx = i; else break; }
          setNowIdx((prev) => (prev === idx ? prev : idx));
        });

        // Seek to 60s before the incident moment.
        if (firstTs > 0) {
          const seekMs = Math.max(0, incident.incident_ts - firstTs - 60_000);
          playerRef.current.goto(seekMs);
        }
      }
    } catch (err) {
      console.error("incident replay load error", err);
    } finally {
      setReplayLoading(false);
    }
  }

  const seekToTs = (ts: number) => playerRef.current?.goto(ts - firstTsRef.current);

  if (fetchError) {
    return (
      <div>
        <button class="back-btn" onClick={onBack}><Icon name="back" /> Back</button>
        <div style="color:var(--red);margin-top:1rem">{fetchError}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <button class="back-btn" onClick={onBack}><Icon name="back" /> Back</button>
        <p class="empty">Loading incident…</p>
      </div>
    );
  }

  const ev = data.event;
  const isBugReport = ev.type === "bug_report";

  return (
    <div class="incident-root">
      <button class="back-btn" onClick={onBack}><Icon name="back" /> Back</button>

      <div class={`incident-header${isBugReport ? " is-bug" : ""}`}>
        <span class={`badge ${isBugReport ? "badge-bug_report" : "badge-error"}`}>
          <Icon name={isBugReport ? "bug" : "error"} size={11} /> {isBugReport ? "bug report" : "error"}
        </span>
        <h2 class="incident-title">{ev.name}</h2>
        <div class="incident-meta">
          <span>{fmtTs(ev.ts)}</span>
          <span>·</span>
          <span style="display:inline-flex;align-items:center;gap:0.3rem"><Avatar id={ev.user_id} size={16} /> {ev.user_id}</span>
          <span>·</span>
          <span class="ts" title={ev.session_id}>{ev.session_id.slice(0, 12)}…</span>
          {ev.url && <><span>·</span><span class="muted">{ev.url}</span></>}
        </div>
        {ev.props?.stack && <StackBlock stack={ev.props.stack} />}
        {isBugReport && ev.props?.severity && (
          <div class="severity-badge">severity: {String(ev.props.severity)}</div>
        )}
      </div>

      <section class="incident-section">
        <h3><Icon name="play" /> Replay {replayLoading && <span class="live-tag"><span class="live-dot" /> loading</span>}</h3>
        {!data.replay_cue && <p class="empty">No replay available for this session</p>}
        {data.replay_cue && <div ref={playerContainerRef} class="player-container" />}
      </section>

      <section class="incident-section">
        <h3><Icon name="clock" /> Breadcrumbs <span class="count">({data.breadcrumbs.length})</span></h3>
        <BreadcrumbsTable events={data.breadcrumbs} incidentTs={data.incident_ts} nowTs={nowTs} onSeek={seekToTs} />
      </section>

      <section class="incident-section">
        <h3><Icon name="network" /> Network</h3>
        <NetworkWaterfall events={data.breadcrumbs} nowTs={nowTs} onSeek={seekToTs} />
      </section>

      <section class="incident-section">
        <h3><Icon name="network" /> Console <span class="count">({consoleLogs.length})</span></h3>
        <ConsolePane logs={consoleLogs} nowIdx={nowIdx} onSeek={seekToTs} />
      </section>
    </div>
  );
}
