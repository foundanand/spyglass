import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Sparkline } from "../components/Sparkline.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { Flows, fmtDuration } from "./Flows.js";
import { SaveView } from "../components/SaveView.js";
import { applyRange, tzOffsetMinutes, type TimeRange } from "../range.js";

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
  top_events: NameCount[];
  top_pages: NameCount[];
  errors_by_day: DayCount[];
}

interface StepTiming {
  p50_ms: number;
  p90_ms: number;
  samples: number;
}

interface FunnelStep {
  name: string;
  count: number;
  /** Time from the previous step. Absent on step 1 and when nothing fits the cap. */
  from_prev?: StepTiming | null;
}

/** Turn a YYYY-MM-DD bucket into an explicit one-day window for a drill-down. */
function dayParams(day: string): string {
  const start = new Date(`${day}T00:00:00`).getTime();
  if (Number.isNaN(start)) return "";
  return new URLSearchParams({ from: String(start), to: String(start + 86_400_000) }).toString();
}

// Bars renders a small horizontal bar chart from name/count rows.
//
// A row may carry an `href`, in which case it renders as a real anchor: every
// aggregate should lead to the rows behind it, and a link nobody can tab to is
// a link that does not exist.
function Bars({
  rows,
  empty,
}: {
  rows: { label: string; count: number; href?: string; title?: string }[];
  empty: string;
}) {
  if (rows.length === 0) return <p class="empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div class="bars">
      {rows.map((r, i) => {
        const inner = (
          <>
            <span class="bar-label" title={r.title ?? r.label}>
              {r.label}
            </span>
            <span class="bar-track">
              <span class="bar-fill" style={`width:${Math.round((r.count / max) * 100)}%`} />
            </span>
            <span class="bar-count">{r.count}</span>
          </>
        );
        return r.href ? (
          <a key={i} class="bar-row bar-row-link" href={r.href}>
            {inner}
          </a>
        ) : (
          <div key={i} class="bar-row">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function FunnelBuilder() {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [toConvert, setToConvert] = useState<StepTiming | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    const names = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length < 2) {
      setErr("Enter at least 2 comma-separated event names");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({ steps: names.join(",") });
      applyRange(params, range);
      const res = await fetch(`/v1/query/funnel?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { steps: FunnelStep[]; to_convert?: StepTiming | null };
      setSteps(d.steps ?? []);
      setToConvert(d.to_convert ?? null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const top = steps.length > 0 ? Math.max(steps[0].count, 1) : 1;

  return (
    <section class="insight-card">
      <h3>
        <Icon name="chevron-right" size={14} /> Funnel
      </h3>
      <div class="toolbar">
        <input
          style="flex:1;min-width:240px"
          placeholder="step1, step2, step3 (event names)"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button onClick={run}>
          <Icon name="chevron-right" size={14} /> Run funnel
        </button>
        {steps.length > 0 && (
          <SaveView
            kind="funnel"
            params={{
              steps: input
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .join(","),
            }}
            suggestedName={`Funnel: ${input.slice(0, 40)}`}
          />
        )}
        {loading && <span class="ts">Loading…</span>}
      </div>
      {err && <div style="color:var(--red);margin-bottom:0.5rem">{err}</div>}
      {steps.length > 0 && (
        <div class="funnel">
          {steps.map((s, i) => {
            const pct = Math.round((s.count / top) * 100);
            const convPct =
              i === 0
                ? 100
                : steps[i - 1].count > 0
                  ? Math.round((s.count / steps[i - 1].count) * 100)
                  : 0;
            return (
              <div key={i} class="funnel-step">
                <div class="funnel-head">
                  <span class="funnel-name">
                    {i + 1}. {s.name}
                  </span>
                  <span class="funnel-count">
                    {s.count}
                    {i > 0 && <span class="funnel-conv"> · {convPct}%</span>}
                  </span>
                </div>
                <div class="funnel-bar-track">
                  <div class="funnel-bar-fill" style={`width:${pct}%`} />
                </div>
                {/* Counts localise a slow step; durations explain it. */}
                {i > 0 && s.from_prev && (
                  <div
                    class="funnel-timing"
                    title={`${s.from_prev.samples} conversion${s.from_prev.samples === 1 ? "" : "s"} timed; gaps over the cap are counted but not timed`}
                  >
                    {fmtDuration(s.from_prev.p50_ms)} median · {fmtDuration(s.from_prev.p90_ms)} p90
                    <span class="funnel-samples"> · n={s.from_prev.samples}</span>
                  </div>
                )}
              </div>
            );
          })}
          {toConvert && (
            <p class="funnel-total">
              End to end: <strong>{fmtDuration(toConvert.p50_ms)}</strong> median ·{" "}
              {fmtDuration(toConvert.p90_ms)} p90, over {toConvert.samples} completed conversion
              {toConvert.samples === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function Behaviour({ range }: { range: TimeRange }) {
  const [agg, setAgg] = useState<Aggregates | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      applyRange(params, range);
      // Day buckets follow the viewer's calendar, not UTC — see store.dayExpr.
      params.set("tz", String(tzOffsetMinutes()));
      const res = await fetch(`/v1/query/aggregates?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAgg((await res.json()) as Aggregates);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [range.key]);

  // DAU / errors_by_day arrive ORDER BY day ASC (oldest→newest), so the last
  // element is the most recent day and the count arrays are already in
  // chronological order for the sparklines.
  const dau = agg?.dau ?? [];
  const errorsByDay = agg?.errors_by_day ?? [];
  const dauCounts = dau.map((d) => d.count);
  const errorCounts = errorsByDay.map((d) => d.count);

  return (
    <div>
      <h2>
        <Icon name="network" size={16} /> Behaviour
        <span class="muted" style="font-weight:400;font-size:0.8rem">
          · what people are doing
        </span>
      </h2>

      <div class="toolbar">
        <button onClick={load}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {err && <div style="color:var(--red);margin-bottom:1rem">{err}</div>}

      {loading && !agg ? (
        <div class="insight-grid">
          <SkeletonRows rows={4} />
        </div>
      ) : (
        <div class="insight-grid">
          <section class="insight-card">
            <h3>
              <Icon name="user" size={14} /> Daily active users
            </h3>
            <div class="card-spark">
              <Sparkline values={dauCounts} width={280} height={40} color="var(--accent)" />
            </div>
            <Bars
              rows={dau.map((d) => ({
                label: d.day,
                count: d.count,
                href: `#/explore?${dayParams(d.day)}`,
                title: `Explore ${d.day}`,
              }))}
              empty="no activity yet"
            />
          </section>

          <section class="insight-card">
            <h3>
              <Icon name="error" size={14} /> Errors by day
            </h3>
            <div class="card-spark">
              <Sparkline values={errorCounts} width={280} height={40} color="var(--c-error)" />
            </div>
            <Bars
              rows={errorsByDay.map((d) => ({
                label: d.day,
                count: d.count,
                href: `#/issues?${dayParams(d.day)}`,
                title: `Issues on ${d.day}`,
              }))}
              empty="no errors — nice"
            />
          </section>

          <section class="insight-card">
            <h3>
              <Icon name="chevron-right" size={14} /> Top events
            </h3>
            <Bars
              rows={(agg?.top_events ?? []).map((n) => ({
                label: n.name,
                count: n.count,
                href: `#/explore?type=event&q=${encodeURIComponent(n.name)}`,
                title: `Explore ${n.name}`,
              }))}
              empty="no captured events"
            />
          </section>

          <section class="insight-card">
            <h3>
              <Icon name="page" size={14} /> Top pages
            </h3>
            <Bars
              rows={(agg?.top_pages ?? []).map((n) => ({
                label: n.name,
                count: n.count,
                href: `#/screen/${encodeURIComponent(n.name)}`,
                title: `Open ${n.name}`,
              }))}
              empty="no pageviews"
            />
          </section>
        </div>
      )}

      <Flows range={range} />

      <FunnelBuilder />
    </div>
  );
}
