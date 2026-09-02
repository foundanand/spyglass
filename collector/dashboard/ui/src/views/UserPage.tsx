// The user page.
//
// A user id appearing in a flow breakdown, an error row or a session row used
// to be inert text everywhere in the product. This is where those links land.
//
// Framing matters here. "PARV0004 is slow at invoicing" is a performance review
// of a person; "invoicing is slower for this person than the team median, so
// the form may assume knowledge they don't have" is a finding about the
// software. The page is built to say the second thing.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { RelTime } from "../components/RelTime.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { FlowLink, SessionLink } from "../components/EntityLink.js";
import { applyRange, type TimeRange } from "../range.js";
import { fmtDuration } from "./Flows.js";

interface Session {
  session_id: string;
  app: string;
  user_id: string;
  started_at: number;
  last_seen: number;
  chunk_count: number;
  event_count: number;
  error_count: number;
  meta?: Record<string, unknown>;
}
interface SpyEvent {
  id: number;
  ts: number;
  user_id: string;
  session_id: string;
  type: string;
  name: string;
  url?: string;
  props?: Record<string, unknown>;
}
interface FlowStat {
  name: string;
  group?: string;
  completions: number;
  abandon_rate: number;
  p50_ms: number;
  p90_ms: number;
}

export function UserPage({ id, range }: { id: string; range: TimeRange }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [issues, setIssues] = useState<SpyEvent[]>([]);
  const [mine, setMine] = useState<FlowStat[]>([]);
  const [team, setTeam] = useState<Map<string, FlowStat>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const win = applyRange(new URLSearchParams(), range);
    const json = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

    Promise.allSettled([
      json(`/v1/query/sessions?limit=300&${win}`),
      json(`/v1/query/events?user=${encodeURIComponent(id)}&limit=100&${win}`),
      // Per-user flow rows, then the same flows overall as the comparison.
      json(`/v1/query/flows?group=user&limit=200&${win}`),
      json(`/v1/query/flows?limit=200&${win}`),
    ]).then((res) => {
      if (cancelled) return;
      const ok = <T,>(i: number): T | null =>
        res[i].status === "fulfilled"
          ? ((res[i] as PromiseFulfilledResult<T>).value ?? null)
          : null;

      setSessions((ok<{ sessions: Session[] }>(0)?.sessions ?? []).filter((s) => s.user_id === id));
      setIssues(
        (ok<{ events: SpyEvent[] }>(1)?.events ?? []).filter(
          (e) => e.type === "error" || e.type === "bug_report",
        ),
      );
      setMine((ok<{ flows: FlowStat[] }>(2)?.flows ?? []).filter((f) => f.group === id));
      setTeam(new Map((ok<{ flows: FlowStat[] }>(3)?.flows ?? []).map((f) => [f.name, f])));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, range.key]);

  const lastSeen = sessions.length > 0 ? Math.max(...sessions.map((s) => s.last_seen)) : 0;
  const errorCount = issues.filter((e) => e.type === "error").length;

  return (
    <div>
      <nav class="crumbs">
        <a href="#/sessions">Sessions</a> <span>/</span> <strong>{id}</strong>
      </nav>
      <h2>
        <Avatar id={id} size={20} /> {id}
      </h2>

      {loading && <SkeletonRows rows={3} />}

      {!loading && (
        <>
          <div class="home-tiles">
            <div class="home-tile">
              <span class="home-tile-label">sessions</span>
              <span class="home-tile-value">{sessions.length}</span>
              <span class="home-tile-foot">in this window</span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">last seen</span>
              <span class="home-tile-value">{lastSeen ? <RelTime ts={lastSeen} /> : "—"}</span>
              <span class="home-tile-foot" />
            </div>
            <div class="home-tile">
              <span class="home-tile-label">errors hit</span>
              <span class="home-tile-value">{errorCount}</span>
              <span class="home-tile-foot">
                {issues.length - errorCount > 0 && `${issues.length - errorCount} reports filed`}
              </span>
            </div>
          </div>

          <section class="home-card">
            <h3>Flows, against the overall median</h3>
            <p class="panel-note">
              A gap here is a question about the software — whether the flow assumes knowledge or a
              screen size this person doesn&rsquo;t have — not a judgement about the person.
            </p>
            {mine.length === 0 ? (
              <p class="home-empty">No measured flows for this person in this window.</p>
            ) : (
              <table>
                <caption class="sr-only">
                  This person's flow timings against the overall median
                </caption>
                <thead>
                  <tr>
                    <th scope="col">flow</th>
                    <th scope="col">runs</th>
                    <th scope="col">their median</th>
                    <th scope="col">overall median</th>
                    <th scope="col">difference</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((f) => {
                    const all = team.get(f.name);
                    const diff =
                      all && all.p50_ms > 0
                        ? Math.round(((f.p50_ms - all.p50_ms) / all.p50_ms) * 100)
                        : null;
                    return (
                      <tr key={f.name}>
                        <td>
                          <FlowLink name={f.name} range={range.key} />
                        </td>
                        <td>{f.completions}</td>
                        <td>{fmtDuration(f.p50_ms)}</td>
                        <td class="ts">{all ? fmtDuration(all.p50_ms) : "—"}</td>
                        <td>
                          {diff === null ? (
                            "—"
                          ) : (
                            <span
                              class={`delta ${diff > 10 ? "delta-bad" : diff < -10 ? "delta-good" : "delta-flat"}`}
                            >
                              {diff > 0 ? "+" : ""}
                              {diff}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section class="home-card">
            <h3>Sessions</h3>
            {sessions.length === 0 ? (
              <p class="home-empty">No sessions in this window.</p>
            ) : (
              <table>
                <caption class="sr-only">This person's sessions, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">started</th>
                    <th scope="col">events</th>
                    <th scope="col">errors</th>
                    <th scope="col">replay</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.session_id}>
                      <td class="ts">
                        <RelTime ts={s.started_at} />
                      </td>
                      <td>{s.event_count}</td>
                      <td>
                        {s.error_count > 0 ? (
                          <span class="badge badge-error">{s.error_count}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {s.chunk_count > 0 ? (
                          <SessionLink id={s.session_id} range={range.key}>
                            watch ▸
                          </SessionLink>
                        ) : (
                          <span class="muted">no recording</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section class="home-card">
            <h3>Errors and reports</h3>
            {issues.length === 0 ? (
              <p class="home-empty">Nothing broke for this person in this window.</p>
            ) : (
              <table>
                <caption class="sr-only">Errors and bug reports this person hit</caption>
                <thead>
                  <tr>
                    <th scope="col">when</th>
                    <th scope="col">type</th>
                    <th scope="col">what</th>
                    <th scope="col">session</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((e) => (
                    <tr key={e.id}>
                      <td class="ts">
                        <RelTime ts={e.ts} />
                      </td>
                      <td>
                        <span class={`badge badge-${e.type}`}>{e.type}</span>
                      </td>
                      <td>
                        <a class="entity-link" href={`#/incident/${e.id}`}>
                          {String(e.props?.comment ?? e.name)}
                        </a>
                      </td>
                      <td>
                        <SessionLink id={e.session_id} range={range.key} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
