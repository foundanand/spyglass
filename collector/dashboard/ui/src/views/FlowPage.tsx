// The flow page — where a duration stops being a number and becomes a story.
//
// "task.create takes 52s at p50 and 96s at p90" immediately generates four more
// questions: is it getting worse, who is slow, what makes it slow, and which
// sessions were the slow ones. Those were four manual queries across two views,
// and the last one was impossible — the aggregate threw session ids away.
//
// Here they are the page.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { RelTime } from "../components/RelTime.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { SessionLink, UserLink } from "../components/EntityLink.js";
import { applyRange, type TimeRange } from "../range.js";
import { fmtDuration } from "./Flows.js";

interface FlowStat {
  name: string;
  group?: string;
  completions: number;
  abandons: number;
  failures: number;
  abandon_rate: number;
  p50_ms: number;
  p90_ms: number;
  p95_ms: number;
  mean_ms: number;
  min_ms: number;
  max_ms: number;
  total_ms: number;
}
interface FlowSession {
  session_id: string;
  user_id: string;
  ts: number;
  duration_ms: number;
  outcome: string;
}
interface Bucket {
  min_ms: number;
  max_ms: number;
  label: string;
  count: number;
}

type Breakdown = "user" | "day" | "session:viewport_bucket" | "trait:role";

const BREAKDOWNS: { value: Breakdown; label: string }[] = [
  { value: "user", label: "by person" },
  { value: "day", label: "by day" },
  { value: "session:viewport_bucket", label: "by device size" },
  { value: "trait:role", label: "by role" },
];

function Histogram({ buckets }: { buckets: Bucket[] }) {
  const populated = buckets.filter((b) => b.count > 0);
  if (populated.length === 0) return <p class="home-empty">No completed runs to plot.</p>;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  // Only draw from the first to the last populated bucket: an axis padded with
  // a dozen empty bars either side reads as missing data.
  const first = buckets.findIndex((b) => b.count > 0);
  const last = buckets.length - 1 - [...buckets].reverse().findIndex((b) => b.count > 0);
  return (
    <div class="histogram">
      {buckets.slice(first, last + 1).map((b) => (
        <div class="histogram-col" key={b.label} title={`${b.label}: ${b.count} runs`}>
          <div class="histogram-bar" style={`height:${Math.max(2, (b.count / max) * 100)}%`}>
            {b.count > 0 && <span class="histogram-count">{b.count}</span>}
          </div>
          <span class="histogram-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function FlowPage({ name, range }: { name: string; range: TimeRange }) {
  const [stat, setStat] = useState<FlowStat | null>(null);
  const [prev, setPrev] = useState<FlowStat | null>(null);
  const [sessions, setSessions] = useState<FlowSession[]>([]);
  const [histogram, setHistogram] = useState<Bucket[]>([]);
  const [breakdown, setBreakdown] = useState<Breakdown>("user");
  const [rows, setRows] = useState<FlowStat[]>([]);
  const [outcome, setOutcome] = useState<"" | "completed" | "abandoned" | "failed">("");
  const [loading, setLoading] = useState(true);

  const base = () => applyRange(new URLSearchParams({ name }), range);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const json = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

    const prevParams = new URLSearchParams({ name });
    if (range.from !== undefined) {
      const span = Date.now() - range.from;
      prevParams.set("from", String(Math.floor(range.from - span)));
      prevParams.set("to", String(Math.floor(range.from)));
    }

    Promise.allSettled([
      json(`/v1/query/flows?${base()}`),
      range.from !== undefined ? json(`/v1/query/flows?${prevParams}`) : Promise.resolve(null),
      json(`/v1/query/flow-detail?${base()}&limit=25${outcome ? `&outcome=${outcome}` : ""}`),
    ]).then((res) => {
      if (cancelled) return;
      const ok = <T,>(i: number): T | null =>
        res[i].status === "fulfilled"
          ? ((res[i] as PromiseFulfilledResult<T>).value ?? null)
          : null;
      setStat(ok<{ flows: FlowStat[] }>(0)?.flows?.[0] ?? null);
      setPrev(ok<{ flows: FlowStat[] }>(1)?.flows?.[0] ?? null);
      const detail = ok<{ sessions: FlowSession[]; histogram: Bucket[] }>(2);
      setSessions(detail?.sessions ?? []);
      setHistogram(detail?.histogram ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [name, range.key, outcome]);

  useEffect(() => {
    let cancelled = false;
    const p = base();
    p.set("group", breakdown);
    fetch(`/v1/query/flows?${p}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setRows(d.flows ?? []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [name, range.key, breakdown]);

  const change =
    stat && prev && prev.p90_ms > 0
      ? Math.round(((stat.p90_ms - prev.p90_ms) / prev.p90_ms) * 100)
      : null;

  return (
    <div>
      <nav class="crumbs">
        <a href="#/behaviour">Behaviour</a> <span>/</span> <strong>{name}</strong>
      </nav>
      <h2>
        <Icon name="clock" size={16} /> {name}
      </h2>

      {loading && <SkeletonRows rows={3} />}

      {!loading && !stat && (
        <p class="home-empty">
          No runs of <code>{name}</code> in this window. Try a wider range.
        </p>
      )}

      {!loading && stat && (
        <>
          <div class="home-tiles">
            <div class="home-tile">
              <span class="home-tile-label">median</span>
              <span class="home-tile-value">{fmtDuration(stat.p50_ms)}</span>
              <span class="home-tile-foot">{stat.completions} completed</span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">p90</span>
              <span class="home-tile-value">{fmtDuration(stat.p90_ms)}</span>
              <span class="home-tile-foot">
                {change !== null && (
                  <span class={`delta ${change > 0 ? "delta-bad" : "delta-good"}`}>
                    {change > 0 ? "▲" : "▼"} {Math.abs(change)}% vs previous
                  </span>
                )}
              </span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">gave up</span>
              <span class="home-tile-value">{Math.round(stat.abandon_rate * 100)}%</span>
              <span class="home-tile-foot">
                {stat.abandons} abandoned{stat.failures > 0 ? `, ${stat.failures} failed` : ""}
              </span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">time spent</span>
              <span class="home-tile-value">{fmtDuration(stat.total_ms)}</span>
              <span class="home-tile-foot">across all completed runs</span>
            </div>
          </div>

          <section class="home-card">
            <h3>Distribution</h3>
            <p class="panel-note">
              A median and a p90 hide a split — &ldquo;half finish in 2s and half take two
              minutes&rdquo; looks the same as a steady spread in percentiles.
            </p>
            <Histogram buckets={histogram} />
          </section>

          <section class="home-card">
            <h3>
              Breakdown
              <select
                class="inline-select"
                aria-label="Break this flow down by"
                value={breakdown}
                onChange={(e) => setBreakdown((e.target as HTMLSelectElement).value as Breakdown)}
              >
                {BREAKDOWNS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </h3>
            {rows.length === 0 ? (
              <p class="home-empty">Nothing to break down on this axis.</p>
            ) : (
              <table>
                <caption class="sr-only">Flow timings broken down</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {BREAKDOWNS.find((b) => b.value === breakdown)?.label.replace("by ", "")}
                    </th>
                    <th scope="col">runs</th>
                    <th scope="col">median</th>
                    <th scope="col">p90</th>
                    <th scope="col">gave up</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.group}/${i}`}>
                      <td>
                        {breakdown === "user" ? (
                          <UserLink id={r.group ?? ""} range={range.key} />
                        ) : (
                          (r.group ?? "unknown")
                        )}
                      </td>
                      <td>{r.completions}</td>
                      <td>{fmtDuration(r.p50_ms)}</td>
                      <td>{fmtDuration(r.p90_ms)}</td>
                      <td>{Math.round(r.abandon_rate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* The point of the whole page: from a number to a recording. */}
          <section class="home-card">
            <h3>
              Slowest sessions
              <select
                class="inline-select"
                aria-label="Filter runs by outcome"
                value={outcome}
                onChange={(e) =>
                  setOutcome((e.target as HTMLSelectElement).value as typeof outcome)
                }
              >
                <option value="">any outcome</option>
                <option value="completed">completed</option>
                <option value="abandoned">abandoned</option>
                <option value="failed">failed</option>
              </select>
            </h3>
            <p class="panel-note">
              Every run below has a full recording behind it — this is the thing a sampling tool
              cannot do.
            </p>
            {sessions.length === 0 ? (
              <p class="home-empty">No runs match.</p>
            ) : (
              <table>
                <caption class="sr-only">
                  Slowest runs of this flow, each linking to its recording
                </caption>
                <thead>
                  <tr>
                    <th scope="col">duration</th>
                    <th scope="col">outcome</th>
                    <th scope="col">person</th>
                    <th scope="col">when</th>
                    <th scope="col">session</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={`${s.session_id}/${i}`}>
                      <td>
                        <strong>{fmtDuration(s.duration_ms)}</strong>
                      </td>
                      <td>
                        <span class={`badge badge-${s.outcome === "completed" ? "flow" : "error"}`}>
                          {s.outcome}
                        </span>
                      </td>
                      <td>
                        <span class="user-cell">
                          <Avatar id={s.user_id} size={16} />
                          <UserLink id={s.user_id} range={range.key} />
                        </span>
                      </td>
                      <td class="ts">
                        <RelTime ts={s.ts} />
                      </td>
                      <td>
                        <SessionLink id={s.session_id} range={range.key}>
                          watch ▸
                        </SessionLink>
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
