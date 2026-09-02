import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { FlowLink, UserLink } from "../components/EntityLink.js";
import { SaveView } from "../components/SaveView.js";
import { applyRange, type TimeRange } from "../range.js";

// Flow durations — the "how long does this take" panel.
//
// Counts tell you an action happened; this tells you what it costs the person
// doing it. The grouping control is the whole point: the same flow read per
// user, per day, or per any prop the app attached answers "who is slow", "is it
// getting worse", and "what makes it slow" without a new endpoint each time.

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

interface NameCount {
  name: string;
  count: number;
}

interface FlowsResponse {
  flows: FlowStat[];
  names: NameCount[];
}

/** Durations read as time, not as a six-digit millisecond count. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

const GROUPS = [
  { value: "", label: "overall" },
  { value: "user", label: "per user" },
  { value: "day", label: "per day" },
  // Session context. These are what turn "task.create takes 52s" into "on
  // mobile it takes 2m10s" — the axes that were unavailable until sessions
  // started carrying meta.
  { value: "session:viewport_bucket", label: "per device size" },
  { value: "session:connection", label: "per connection" },
  { value: "session:tz", label: "per timezone" },
  { value: "session:language", label: "per language" },
];

// Cohort attributes the host app declares via user.traits. Free-text, because
// spyglass cannot know what a given app calls its roles.
const TRAIT_GROUP = "trait";

// A flow from a session recorded before context existed (or with context:false)
// has no value to bucket by. It is still counted; label it honestly.
const UNKNOWN_GROUP = "unknown";

export function Flows({ range }: { range: TimeRange }) {
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [propKey, setPropKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (name) params.set("name", name);
      // A keyed grouping needs both halves; sending "prop:" alone is a 400.
      if (group === "prop" || group === TRAIT_GROUP) {
        if (propKey) params.set("group", `${group}:${propKey}`);
      } else if (group) {
        params.set("group", group);
      }
      applyRange(params, range);
      const res = await fetch(`/v1/query/flows?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as FlowsResponse);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [name, group, propKey, range.key]);

  /** The panel's own parameters, without the window — a board supplies that. */
  function savedParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (name) p.name = name;
    if (group === "prop" || group === TRAIT_GROUP) {
      if (propKey) p.group = `${group}:${propKey}`;
    } else if (group) {
      p.group = group;
    }
    return p;
  }

  const flows = data?.flows ?? [];
  const names = data?.names ?? [];
  const grouped = group !== "";

  return (
    <section class="insight-card">
      <h3>
        <Icon name="clock" size={14} /> Flow durations
      </h3>

      <div class="toolbar">
        <select
          aria-label="Flow to show"
          value={name}
          onChange={(e) => setName((e.target as HTMLSelectElement).value)}
        >
          <option value="">all flows</option>
          {names.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name} ({n.count})
            </option>
          ))}
        </select>

        <select
          aria-label="Group flow durations by"
          value={group}
          onChange={(e) => setGroup((e.target as HTMLSelectElement).value)}
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
          <option value="prop">per prop…</option>
          <option value={TRAIT_GROUP}>per user trait…</option>
        </select>

        {(group === "prop" || group === TRAIT_GROUP) && (
          <input
            style="width:140px"
            placeholder={group === TRAIT_GROUP ? "trait key (e.g. role)" : "prop key"}
            value={propKey}
            onInput={(e) => setPropKey((e.target as HTMLInputElement).value)}
          />
        )}

        <button onClick={load}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        <SaveView
          kind="flows"
          params={savedParams()}
          suggestedName={name ? `${name}${group ? ` by ${group}` : ""}` : "All flows"}
        />
        {loading && <span class="ts">Loading…</span>}
      </div>

      {err && <div style="color:var(--red);margin-bottom:0.5rem">{err}</div>}

      {loading && !data ? (
        <SkeletonRows rows={3} />
      ) : flows.length === 0 ? (
        <p class="empty">
          no flows recorded — call spyglass.startFlow(name) and spyglass.endFlow(name) around an
          action to time it
        </p>
      ) : (
        <table class="flow-table">
          <caption class="sr-only">Flow durations</caption>
          <thead>
            <tr>
              <th scope="col">{grouped ? "group" : "flow"}</th>
              <th scope="col">runs</th>
              <th scope="col">p50</th>
              <th scope="col">p90</th>
              <th scope="col">mean</th>
              <th scope="col">max</th>
              <th scope="col">abandoned</th>
              <th scope="col">total time</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f, i) => (
              <tr key={`${f.name}/${f.group ?? ""}/${i}`}>
                <td
                  class="flow-name"
                  title={grouped ? `${f.name} · ${f.group || UNKNOWN_GROUP}` : f.name}
                >
                  {grouped ? (
                    group === "user" ? (
                      <UserLink id={f.group ?? ""} range={range.key} />
                    ) : (
                      f.group || UNKNOWN_GROUP
                    )
                  ) : (
                    <FlowLink name={f.name} range={range.key} />
                  )}
                </td>
                <td>{f.completions}</td>
                <td class="flow-p50">{fmtDuration(f.p50_ms)}</td>
                <td>{fmtDuration(f.p90_ms)}</td>
                <td>{fmtDuration(f.mean_ms)}</td>
                <td class="flow-muted">{fmtDuration(f.max_ms)}</td>
                <td class={f.abandon_rate >= 0.2 ? "flow-abandon-warn" : "flow-muted"}>
                  {f.abandons + f.failures === 0 ? "—" : `${Math.round(f.abandon_rate * 100)}%`}
                </td>
                <td class="flow-muted">{fmtDuration(f.total_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
