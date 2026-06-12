import { useEffect, useRef, useState } from "preact/hooks";
import "rrweb-player/dist/style.css";

interface Session {
  session_id: string;
  app: string;
  user_id: string;
  started_at: number;
  last_seen: number;
  chunk_count: number;
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

// rrweb EventType.Plugin === 6
const PLUGIN_EVENT = 6;
const CONSOLE_PLUGIN = "@rrweb/rrweb-plugin-console-record";

export function ReplayPlayer() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLine[]>([]);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);

  useEffect(() => {
    fetch("/v1/query/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, []);

  async function openSession(session: Session) {
    if (loading) return;
    setSelected(session);
    setLoading(true);
    setConsoleLogs([]);

    try {
      // Destroy previous player instance.
      if (playerRef.current) {
        try { playerRef.current.$destroy(); } catch { /* noop */ }
        playerRef.current = null;
      }
      if (playerContainerRef.current) {
        playerContainerRef.current.innerHTML = "";
      }

      // Fetch manifest.
      const manifest = await fetch(`/v1/sessions/${session.session_id}/replay`).then((r) =>
        r.json()
      );
      const chunks: ChunkInfo[] = manifest.chunks ?? [];

      if (chunks.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch all chunks sequentially and merge into one event array.
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

      // Mount rrweb-player.
      if (playerContainerRef.current && allEvents.length > 0) {
        const mod = await import("rrweb-player");
        const Player = (mod as Record<string, unknown>).default as new (opts: {
          target: HTMLElement;
          props: {
            events: unknown[];
            width: number;
            height: number;
            autoPlay: boolean;
          };
        }) => unknown;

        playerRef.current = new Player({
          target: playerContainerRef.current,
          props: {
            events: allEvents,
            width: playerContainerRef.current.clientWidth || 900,
            height: 540,
            autoPlay: false,
          },
        });
      }
    } catch (err) {
      console.error("replay load error", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="replay-root">
      <div class="sessions-sidebar">
        <h2>Sessions</h2>
        {sessions.length === 0 && <p class="empty">No sessions yet</p>}
        {sessions.map((s) => (
          <div
            key={s.session_id}
            class={`session-item${selected?.session_id === s.session_id ? " active" : ""}`}
            onClick={() => openSession(s)}
          >
            <span class="session-user">{s.user_id}</span>
            <span class="session-meta">{new Date(s.last_seen).toLocaleString()}</span>
            <span class="session-chunks">
              {s.chunk_count} chunk{s.chunk_count !== 1 ? "s" : ""} · {s.app}
            </span>
          </div>
        ))}
      </div>

      <div class="replay-main">
        {!selected && <p class="empty">Select a session to watch its replay</p>}
        {selected && (
          <>
            <div class="replay-header">
              <strong>{selected.user_id}</strong>
              <span class="ts">{new Date(selected.started_at).toLocaleString()}</span>
              {loading && <span class="ts">Loading…</span>}
            </div>
            <div ref={playerContainerRef} class="player-container" />
            {consoleLogs.length > 0 && (
              <div class="console-pane">
                <h3>Console ({consoleLogs.length})</h3>
                <div class="console-lines">
                  {consoleLogs.map((l, i) => (
                    <div key={i} class={`console-line level-${l.level}`}>
                      <span class="console-ts">{new Date(l.ts).toLocaleTimeString()}</span>
                      <span class="console-level">{l.level}</span>
                      <span class="console-msg">
                        {l.payload
                          .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
                          .join(" ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
