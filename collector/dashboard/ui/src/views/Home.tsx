// Home — "does anything need my attention?"
//
// The dashboard used to open on an unfiltered event stream: the rawest view in
// the product, and ~89% network noise on real data. An analytics tool is judged
// in its first thirty seconds and those thirty seconds were spent looking at
// HTTP requests.
//
// The organising rule here: **every tile is a finding, and every finding links
// to the thing that explains it.** A home page of numbers that lead nowhere is
// a worse version of the page this one replaced.
//
// Deliberately not here: retention curves, cohorts, path diagrams, feature
// flags, experiments. Those come with a weight this project exists to avoid.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { RelTime } from "../components/RelTime.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { FlowLink, SessionLink, UserLink } from "../components/EntityLink.js";
import { applyRange, tzOffsetMinutes, type TimeRange } from "../range.js";
import { fmtDuration } from "./Flows.js";

interface DayCount {
  day: string;
  count: number;
}
interface NameCount {
  name: string;
  count: number;
}
interface Aggregates {
  dau: DayCount[];
  errors_by_day: DayCount[];
  top_events: NameCount[];
  top_pages: NameCount[];
}
interface FlowStat {
  name: string;
  group?: string;
  completions: number;
  abandons: number;
  abandon_rate: number;
  p50_ms: number;
  p90_ms: number;
}
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

/** The window immediately before the current one, of equal length. */
function previousWindow(range: TimeRange): { from?: number; to: number } | null {
  if (range.from === undefined) return null; // "All" has no previous period
  const now = Date.now();
  const span = now - range.from;
  return { from: range.from - span, to: range.from };
}

function pct(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null; // null = "new", not "+∞%"
  return Math.round(((now - before) / before) * 100);
}

/** A signed change, coloured by whether the direction is good news. */
function Delta({ value, goodWhenDown }: { value: number | null; goodWhenDown?: boolean }) {
  if (value === null) return <span class="delta delta-new">new</span>;
  if (value === 0) return <span class="delta delta-flat">no change</span>;
  const up = value > 0;
  const bad = goodWhenDown ? up : !up;
  return (
    <span class={`delta ${bad ? "delta-bad" : "delta-good"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

function Tile({
  label,
  value,
  delta,
  goodWhenDown,
  href,
  hint,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  goodWhenDown?: boolean;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <span class="home-tile-label">{label}</span>
      <span class="home-tile-value">{value}</span>
      <span class="home-tile-foot">
        {delta !== undefined && <Delta value={delta} goodWhenDown={goodWhenDown} />}
        {hint && <span class="home-tile-hint">{hint}</span>}
      </span>
    </>
  );
  return href ? (
    <a class="home-tile home-tile-link" href={href}>
      {body}
    </a>
  ) : (
    <div class="home-tile">{body}</div>
  );
}

export function Home({ range }: { range: TimeRange }) {
  const [agg, setAgg] = useState<Aggregates | null>(null);
  const [prevAgg, setPrevAgg] = useState<Aggregates | null>(null);
  const [flows, setFlows] = useState<FlowStat[]>([]);
  const [prevFlows, setPrevFlows] = useState<FlowStat[]>([]);
  const [reports, setReports] = useState<SpyEvent[]>([]);
  const [errors, setErrors] = useState<SpyEvent[]>([]);
  const [prevErrorNames, setPrevErrorNames] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<SpyEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const cur = applyRange(new URLSearchParams(), range);
    const prev = previousWindow(range);
    const prevParams = new URLSearchParams();
    if (prev?.from !== undefined) prevParams.set("from", String(Math.floor(prev.from)));
    if (prev) prevParams.set("to", String(Math.floor(prev.to)));

    const json = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

    Promise.allSettled([
      json(`/v1/query/aggregates?${cur}&tz=${tzOffsetMinutes()}`),
      prev
        ? json(`/v1/query/aggregates?${prevParams}&tz=${tzOffsetMinutes()}`)
        : Promise.resolve(null),
      json(`/v1/query/flows?${cur}&limit=100`),
      prev ? json(`/v1/query/flows?${prevParams}&limit=100`) : Promise.resolve(null),
      json(`/v1/query/events?type=bug_report&limit=5&${cur}`),
      json(`/v1/query/events?type=error&limit=100&${cur}`),
      prev ? json(`/v1/query/events?type=error&limit=200&${prevParams}`) : Promise.resolve(null),
      json(`/v1/query/events?exclude=network&limit=8&${cur}`),
    ]).then((res) => {
      if (cancelled) return;
      const val = <T,>(i: number): T | null =>
        res[i].status === "fulfilled"
          ? ((res[i] as PromiseFulfilledResult<T>).value ?? null)
          : null;

      setAgg(val<Aggregates>(0));
      setPrevAgg(val<Aggregates>(1));
      setFlows(val<{ flows: FlowStat[] }>(2)?.flows ?? []);
      setPrevFlows(val<{ flows: FlowStat[] }>(3)?.flows ?? []);
      setReports(val<{ events: SpyEvent[] }>(4)?.events ?? []);
      setErrors(val<{ events: SpyEvent[] }>(5)?.events ?? []);
      setPrevErrorNames(new Set((val<{ events: SpyEvent[] }>(6)?.events ?? []).map((e) => e.name)));
      setRecent(val<{ events: SpyEvent[] }>(7)?.events ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [range.key]);

  // ---- headline numbers ----
  const dau = agg?.dau ?? [];
  const activeUsers = new Set<string>();
  const users = dau.reduce((n, d) => n + d.count, 0);
  const prevUsers = (prevAgg?.dau ?? []).reduce((n, d) => n + d.count, 0);
  void activeUsers;

  const errorCount = errors.length;
  const prevErrorCount = (prevAgg?.errors_by_day ?? []).reduce((n, d) => n + d.count, 0);

  // Genuinely new error signatures are far more actionable than a total.
  const newErrors = (() => {
    const seen = new Map<string, { name: string; count: number; id: number; session: string }>();
    for (const e of errors) {
      if (prevErrorNames.has(e.name)) continue;
      const cur = seen.get(e.name);
      if (cur) cur.count++;
      else seen.set(e.name, { name: e.name, count: 1, id: e.id, session: e.session_id });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  })();

  // Flows that got slower — the most valuable thing this page can say, and
  // nothing else in the tool surfaces it.
  const slower = (() => {
    const before = new Map(prevFlows.map((f) => [f.name, f]));
    const out: { flow: FlowStat; wasP90: number; change: number }[] = [];
    for (const f of flows) {
      const b = before.get(f.name);
      if (!b || b.p90_ms === 0 || f.completions < 3 || b.completions < 3) continue;
      const change = Math.round(((f.p90_ms - b.p90_ms) / b.p90_ms) * 100);
      if (change >= 20) out.push({ flow: f, wasP90: b.p90_ms, change });
    }
    return out.sort((a, b) => b.change - a.change).slice(0, 4);
  })();

  const worstAbandon = [...flows]
    .filter((f) => f.completions + f.abandons >= 5)
    .sort((a, b) => b.abandon_rate - a.abandon_rate)
    .slice(0, 3);

  const nothingWrong =
    !loading && slower.length === 0 && newErrors.length === 0 && reports.length === 0;

  return (
    <div>
      <h2>
        <Icon name="search" size={16} /> Home
        <span class="muted" style="font-weight:400;font-size:0.8rem">
          · last {range.label.toLowerCase()}
          {previousWindow(range) ? ", compared with the period before" : ""}
        </span>
      </h2>

      {loading && <SkeletonRows rows={3} />}

      {!loading && (
        <>
          <div class="home-tiles">
            <Tile
              label="active users"
              value={users}
              delta={previousWindow(range) ? pct(users, prevUsers) : undefined}
              href="#/sessions"
              hint="daily actives, summed"
            />
            <Tile
              label="errors"
              value={errorCount}
              delta={previousWindow(range) ? pct(errorCount, prevErrorCount) : undefined}
              goodWhenDown
              href="#/issues"
            />
            <Tile
              label="bug reports"
              value={reports.length}
              goodWhenDown
              href="#/issues"
              hint={reports.length ? "somebody took the trouble to file these" : "none filed"}
            />
            <Tile
              label="flows measured"
              value={flows.length}
              href="#/behaviour"
              hint={flows.length ? "" : "call startFlow() to measure one"}
            />
          </div>

          {nothingWrong && (
            <p class="home-allclear">
              <Icon name="chevron-right" size={14} /> Nothing needs attention in this window — no
              new error types, no flow regressions, no bug reports.
            </p>
          )}

          <div class="home-cols">
            {/* --- Flows that got slower --- */}
            <section class="home-card">
              <h3>Flows that got slower</h3>
              {slower.length === 0 ? (
                <p class="home-empty">
                  {previousWindow(range)
                    ? "No flow is meaningfully slower than the previous period."
                    : "Pick a bounded window to compare periods."}
                </p>
              ) : (
                <ul class="home-list">
                  {slower.map(({ flow, wasP90, change }) => (
                    <li key={flow.name}>
                      <FlowLink name={flow.name} range={range.key} />
                      <span class="home-list-detail">
                        p90 {fmtDuration(wasP90)} → <strong>{fmtDuration(flow.p90_ms)}</strong>{" "}
                        <span class="delta delta-bad">▲ {change}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- New error types --- */}
            <section class="home-card">
              <h3>New error types</h3>
              {newErrors.length === 0 ? (
                <p class="home-empty">
                  No error signature appeared that wasn&rsquo;t already happening before.
                </p>
              ) : (
                <ul class="home-list">
                  {newErrors.map((e) => (
                    <li key={e.name}>
                      <a class="entity-link" href={`#/incident/${e.id}`}>
                        {e.name}
                      </a>
                      <span class="home-list-detail">
                        {e.count}× ·{" "}
                        <SessionLink id={e.session} range={range.key}>
                          watch
                        </SessionLink>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- Bug reports --- */}
            <section class="home-card">
              <h3>Recent bug reports</h3>
              {reports.length === 0 ? (
                <p class="home-empty">Nobody has filed one in this window.</p>
              ) : (
                <ul class="home-list">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <a class="entity-link" href={`#/incident/${r.id}`}>
                        {String(r.props?.comment ?? r.name)}
                      </a>
                      <span class="home-list-detail">
                        <UserLink id={r.user_id} range={range.key} /> · <RelTime ts={r.ts} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- Most abandoned --- */}
            <section class="home-card">
              <h3>Most abandoned flows</h3>
              {worstAbandon.length === 0 ? (
                <p class="home-empty">Not enough runs to judge abandonment yet.</p>
              ) : (
                <ul class="home-list">
                  {worstAbandon.map((f) => (
                    <li key={f.name}>
                      <FlowLink name={f.name} range={range.key} />
                      <span class="home-list-detail">
                        {Math.round(f.abandon_rate * 100)}% gave up · {f.completions + f.abandons}{" "}
                        runs
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* --- A short live strip, deliberate actions only --- */}
          <section class="home-card home-recent">
            <h3>
              Latest activity
              <a class="home-more" href="#/explore">
                open Explore <Icon name="chevron-right" size={12} />
              </a>
            </h3>
            {recent.length === 0 ? (
              <p class="home-empty">No events in this window.</p>
            ) : (
              <table class="home-recent-table">
                <caption class="sr-only">Latest activity</caption>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id}>
                      <td class="ts">
                        <RelTime ts={e.ts} />
                      </td>
                      <td>
                        <span class="user-cell">
                          <Avatar id={e.user_id} size={16} />
                          <UserLink id={e.user_id} range={range.key} />
                        </span>
                      </td>
                      <td>
                        <span class={`badge badge-${e.type}`}>{e.type}</span>
                      </td>
                      <td class="home-recent-name">
                        {e.type === "flow" ? (
                          <FlowLink name={e.name} range={range.key} />
                        ) : e.type === "pageview" ? (
                          <ScreenLinkInline path={e.name} rangeKey={range.key} />
                        ) : (
                          e.name
                        )}
                      </td>
                      <td class="ts">
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

// Small local wrapper so the import list above stays honest about what it uses.
function ScreenLinkInline({ path, rangeKey }: { path: string; rangeKey: string }) {
  return (
    <a
      class="entity-link"
      href={`#/screen/${encodeURIComponent(path)}${rangeKey !== "30d" ? `?range=${rangeKey}` : ""}`}
    >
      {path}
    </a>
  );
}
