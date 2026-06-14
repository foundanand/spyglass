import { useEffect, useState } from "preact/hooks";

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

interface FunnelStep {
  name: string;
  count: number;
}

// Bars renders a small horizontal bar chart from name/count rows.
function Bars({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  if (rows.length === 0) return <p class="empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div class="bars">
      {rows.map((r, i) => (
        <div key={i} class="bar-row">
          <span class="bar-label" title={r.label}>{r.label}</span>
          <span class="bar-track">
            <span class="bar-fill" style={`width:${Math.round((r.count / max) * 100)}%`} />
          </span>
          <span class="bar-count">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function FunnelBuilder() {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    const names = input.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length < 2) {
      setErr("Enter at least 2 comma-separated event names");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/v1/query/funnel?steps=${encodeURIComponent(names.join(","))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { steps: FunnelStep[] };
      setSteps(d.steps ?? []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const top = steps.length > 0 ? Math.max(steps[0].count, 1) : 1;

  return (
    <section class="insight-card">
      <h3>Funnel</h3>
      <div class="toolbar">
        <input
          style="flex:1;min-width:240px"
          placeholder="step1, step2, step3 (event names)"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
        />
        <button onClick={run}>Run funnel</button>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {err && <div style="color:var(--red);margin-bottom:0.5rem">{err}</div>}
      {steps.length > 0 && (
        <div class="funnel">
          {steps.map((s, i) => {
            const pct = Math.round((s.count / top) * 100);
            const convPct = i === 0 ? 100 : steps[i - 1].count > 0
              ? Math.round((s.count / steps[i - 1].count) * 100)
              : 0;
            return (
              <div key={i} class="funnel-step">
                <div class="funnel-head">
                  <span class="funnel-name">{i + 1}. {s.name}</span>
                  <span class="funnel-count">{s.count}{i > 0 && <span class="funnel-conv"> · {convPct}%</span>}</span>
                </div>
                <div class="funnel-bar-track">
                  <div class="funnel-bar-fill" style={`width:${pct}%`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Insights() {
  const [agg, setAgg] = useState<Aggregates | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/v1/query/aggregates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAgg(await res.json() as Aggregates);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h2>Insights</h2>
      <div class="toolbar">
        <button onClick={load}>Refresh</button>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {err && <div style="color:var(--red);margin-bottom:1rem">{err}</div>}

      <div class="insight-grid">
        <section class="insight-card">
          <h3>Daily active users</h3>
          <Bars
            rows={(agg?.dau ?? []).map((d) => ({ label: d.day, count: d.count }))}
            empty="no activity yet"
          />
        </section>

        <section class="insight-card">
          <h3>Errors by day</h3>
          <Bars
            rows={(agg?.errors_by_day ?? []).map((d) => ({ label: d.day, count: d.count }))}
            empty="no errors — nice"
          />
        </section>

        <section class="insight-card">
          <h3>Top events</h3>
          <Bars
            rows={(agg?.top_events ?? []).map((n) => ({ label: n.name, count: n.count }))}
            empty="no captured events"
          />
        </section>

        <section class="insight-card">
          <h3>Top pages</h3>
          <Bars
            rows={(agg?.top_pages ?? []).map((n) => ({ label: n.name, count: n.count }))}
            empty="no pageviews"
          />
        </section>
      </div>

      <FunnelBuilder />
    </div>
  );
}
