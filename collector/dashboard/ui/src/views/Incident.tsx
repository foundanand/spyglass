import { useEffect, useRef, useState } from "preact/hooks";
import "rrweb-player/dist/style.css";

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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
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

function BreadcrumbsTable({ events }: { events: SpyEvent[] }) {
  const TYPE_COLORS: Record<string, string> = {
    event: "badge-event",
    pageview: "badge-pageview",
    error: "badge-error",
    network: "badge-network",
    bug_report: "badge-bug_report",
  };

  return (
    <table>
      <thead>
        <tr>
          <th>time</th>
          <th>type</th>
          <th>name / url</th>
          <th>details</th>
        </tr>
      </thead>
      <tbody>
        {events.length === 0 && (
          <tr><td colSpan={4} class="empty">no breadcrumbs</td></tr>
        )}
        {events.map((e) => (
          <tr key={e.id}>
            <td class="ts">{fmtTs(e.ts)}</td>
            <td><span class={`badge ${TYPE_COLORS[e.type] ?? "badge-event"}`}>{e.type}</span></td>
            <td>{e.name || e.url || "—"}</td>
            <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {e.props ? JSON.stringify(e.props) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NetworkWaterfall({ events }: { events: SpyEvent[] }) {
  const networkEvents = events.filter((e) => e.type === "network");
  if (networkEvents.length === 0) return <p class="empty">no network requests in window</p>;

  // Compute relative bar widths based on duration.
  const maxDuration = Math.max(
    ...networkEvents.map((e) => (e.props?.duration_ms as number) ?? 0),
    1
  );

  return (
    <table class="network-table">
      <thead>
        <tr>
          <th>method</th>
          <th>url</th>
          <th>status</th>
          <th>duration</th>
          <th style="width:120px">waterfall</th>
        </tr>
      </thead>
      <tbody>
        {networkEvents.map((e, i) => {
          const method = String(e.props?.method ?? "GET");
          const status = Number(e.props?.status ?? 0);
          const dur = Number(e.props?.duration_ms ?? 0);
          const pct = Math.round((dur / maxDuration) * 100);
          const statusClass = status >= 500 ? "status-5xx" : status >= 400 ? "status-4xx" : status >= 300 ? "status-3xx" : "status-2xx";
          return (
            <tr key={i}>
              <td class="ts">{method}</td>
              <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px"
                title={e.name}>{e.name}</td>
              <td><span class={`status-badge ${statusClass}`}>{status || "—"}</span></td>
              <td class="ts">{dur ? fmtDuration(dur) : "—"}</td>
              <td>
                <div class="waterfall-bar" style={`width:${pct}%;min-width:2px`} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConsolePane({ logs }: { logs: ConsoleLine[] }) {
  if (logs.length === 0) return <p class="empty">no console output in replay</p>;
  return (
    <div class="console-lines">
      {logs.map((l, i) => (
        <div key={i} class={`console-line level-${l.level}`}>
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
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);

  useEffect(() => {
    fetch(`/v1/incidents/${eventId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<IncidentData>;
      })
      .then((d) => {
        setData(d);
      })
      .catch((e: unknown) => setFetchError(String(e)));
  }, [eventId]);

  // Load replay when incident data is ready and there's a replay_cue.
  useEffect(() => {
    if (!data?.replay_cue) return;
    void loadReplay(data);
  }, [data?.session_id]);

  async function loadReplay(incident: IncidentData) {
    setReplayLoading(true);
    setConsoleLogs([]);

    try {
      if (playerRef.current) {
        try { playerRef.current.$destroy(); } catch { /* noop */ }
        playerRef.current = null;
      }
      if (playerContainerRef.current) {
        playerContainerRef.current.innerHTML = "";
      }

      // Fetch full manifest (seek requires the full event stream).
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
      }

      setConsoleLogs(logs);

      if (playerContainerRef.current && allEvents.length > 0) {
        const mod = await import("rrweb-player");
        const Player = (mod as Record<string, unknown>).default as new (opts: {
          target: HTMLElement;
          props: { events: unknown[]; width: number; height: number; autoPlay: boolean };
        }) => Record<string, unknown>;

        playerRef.current = new Player({
          target: playerContainerRef.current,
          props: {
            events: allEvents,
            width: playerContainerRef.current.clientWidth || 900,
            height: 480,
            autoPlay: false,
          },
        });

        // Seek to 60s before the incident moment.
        const firstEvent = allEvents[0] as Record<string, unknown>;
        const firstTs = firstEvent?.timestamp as number ?? 0;
        if (firstTs > 0) {
          const seekMs = Math.max(0, incident.incident_ts - firstTs - 60_000);
          setTimeout(() => {
            try {
              (playerRef.current as Record<string, (n: number) => void>)?.goto?.(seekMs);
            } catch { /* player may not expose goto */ }
          }, 300);
        }
      }
    } catch (err) {
      console.error("incident replay load error", err);
    } finally {
      setReplayLoading(false);
    }
  }

  if (fetchError) {
    return (
      <div>
        <button class="back-btn" onClick={onBack}>← Back</button>
        <div style="color:var(--red);margin-top:1rem">{fetchError}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <button class="back-btn" onClick={onBack}>← Back</button>
        <p class="empty">Loading incident…</p>
      </div>
    );
  }

  const ev = data.event;
  const isBugReport = ev.type === "bug_report";

  return (
    <div class="incident-root">
      <button class="back-btn" onClick={onBack}>← Back</button>

      {/* Header */}
      <div class="incident-header">
        <span class={`badge ${isBugReport ? "badge-bug_report" : "badge-error"}`}>
          {isBugReport ? "bug report" : "error"}
        </span>
        <h2 class="incident-title">{ev.name}</h2>
        <div class="incident-meta">
          <span>{fmtTs(ev.ts)}</span>
          <span>·</span>
          <span>{ev.user_id}</span>
          <span>·</span>
          <span class="ts" title={ev.session_id}>{ev.session_id.slice(0, 12)}…</span>
          {ev.url && <><span>·</span><span class="muted">{ev.url}</span></>}
        </div>
        {ev.props?.stack && <StackBlock stack={ev.props.stack} />}
        {isBugReport && ev.props?.severity && (
          <div class="severity-badge">severity: {String(ev.props.severity)}</div>
        )}
      </div>

      {/* Replay */}
      <section class="incident-section">
        <h3>Replay {replayLoading && <span class="ts">Loading…</span>}</h3>
        {!data.replay_cue && <p class="empty">No replay available for this session</p>}
        {data.replay_cue && (
          <div ref={playerContainerRef} class="player-container" />
        )}
      </section>

      {/* Breadcrumbs */}
      <section class="incident-section">
        <h3>Breadcrumbs <span class="count">({data.breadcrumbs.length})</span></h3>
        <BreadcrumbsTable events={data.breadcrumbs} />
      </section>

      {/* Network waterfall */}
      <section class="incident-section">
        <h3>Network</h3>
        <NetworkWaterfall events={data.breadcrumbs} />
      </section>

      {/* Console */}
      <section class="incident-section">
        <h3>Console <span class="count">({consoleLogs.length})</span></h3>
        <ConsolePane logs={consoleLogs} />
      </section>
    </div>
  );
}
