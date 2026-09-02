import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { StatTile, StatStrip } from "../components/StatTile.js";
import { PropsChips } from "../components/PropsChips.js";
import { applyRange, type TimeRange } from "../range.js";
import { rowButton } from "../components/rowProps.js";
import { SessionLink, UserLink } from "../components/EntityLink.js";

interface Event {
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

interface LiveFeedProps {
  onOpenIncident: (id: number) => void;
  range: TimeRange;
  /** "" = activity (everything except network); otherwise a single type. */
  type: string;
  onTypeChange: (type: string) => void;
}

const TYPE_BADGES: Record<string, string> = {
  event: "badge-event",
  pageview: "badge-pageview",
  error: "badge-error",
  network: "badge-network",
  bug_report: "badge-bug_report",
  flow: "badge-flow",
};

// "all" here means "everything a person did" — network is excluded from it and
// reachable as its own chip.
//
// On real data network events are ~89% of the feed: one measured 25-minute
// session logged 254 network rows against 17 pageviews, 9 errors, 4 captures
// and 4 flows. With a 100-row budget and a time ordering, the first screen of
// the landing view could be entirely HTTP chatter with not one deliberate
// action visible. The capability is untouched; only the default changed.
const SEG_OPTIONS: { value: string; label: string; color?: string }[] = [
  { value: "", label: "activity" },
  { value: "event", label: "event", color: "var(--c-event)" },
  { value: "pageview", label: "pageview", color: "var(--c-pageview)" },
  { value: "error", label: "error", color: "var(--c-error)" },
  { value: "network", label: "network", color: "var(--c-network)" },
  { value: "bug_report", label: "report", color: "var(--c-bug)" },
  { value: "flow", label: "flow", color: "var(--c-flow)" },
];

/** Types hidden by the default "activity" view. */
const NOISY_TYPES = ["network"];

// number of table columns (time, type, user, name, url, props, chevron)
const COL_COUNT = 7;

function fmtTs(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Bucket events into per-minute counts for a compact sparkline.
function minuteBuckets(events: Event[]): number[] {
  if (events.length === 0) return [];
  const buckets = new Map<number, number>();
  for (const e of events) {
    const m = Math.floor(e.ts / 60000);
    buckets.set(m, (buckets.get(m) ?? 0) + 1);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((k) => buckets.get(k) ?? 0);
}

export function LiveFeed({ onOpenIncident, range, type, onTypeChange }: LiveFeedProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const filterType = type;
  const setFilterType = onTypeChange;
  const [filterApp, setFilterApp] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Pages of history appended below the live page. Non-empty means the reader
  // is browsing backwards, and polling pauses so a refresh cannot yank the
  // ground out from under them.
  const [older, setOlder] = useState<Event[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const browsing = older.length > 0;

  /** The filters every read of this view shares — feed, count and export alike. */
  function queryParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (filterUser) params.set("user", filterUser);
    if (filterType) params.set("type", filterType);
    // Exclude in SQL, not in the browser: filtering after the fact would spend
    // the row budget on the rows being thrown away.
    else params.set("exclude", NOISY_TYPES.join(","));
    if (filterApp) params.set("app", filterApp);
    applyRange(params, range);
    return params;
  }
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const lastIdRef = useRef(0);

  // Type counts for the chip badges. Refreshed with the window and filters that
  // affect them, but not with the poll — a badge that flickers every 5s is
  // noise of a different kind.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterUser) params.set("user", filterUser);
    if (filterApp) params.set("app", filterApp);
    applyRange(params, range);
    fetch(`/v1/query/counts?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setCounts(d.counts ?? {}))
      .catch(() => setCounts({}));
  }, [filterUser, filterApp, range.key]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const params = queryParams();
        params.set("limit", "200");

        const res = await fetch(`/v1/query/events?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: Event[]; next?: string };
        if (!cancelled) {
          setNextCursor(data.next ?? "");
          const prevTop = lastIdRef.current;
          const list = data.events ?? [];
          setEvents(list);
          setError(null);
          // Flash only rows newer than the previous top id; skip the very
          // first load (prevTop === 0) so we don't flash the whole table.
          const fresh = new Set<number>();
          if (prevTop > 0) {
            for (const ev of list) {
              if (ev.id > prevTop) fresh.add(ev.id);
            }
          }
          setNewIds(fresh);
          if (list.length) {
            lastIdRef.current = list[0]?.id ?? 0;
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    // Paused while reading history: a poll would replace the live page and
    // strand the pages appended below it.
    if (browsing) return;

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // range.key belongs here: without it the interval keeps calling a closure
    // holding the old window, and changing the range would never take effect.
  }, [filterUser, filterType, filterApp, range.key, browsing]);

  // Changing a filter or the window invalidates the history already loaded.
  useEffect(() => {
    setOlder([]);
    setNextCursor("");
  }, [filterUser, filterType, filterApp, range.key]);

  async function loadOlder() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = queryParams();
      params.set("limit", "200");
      params.set("cursor", nextCursor);
      const res = await fetch(`/v1/query/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: Event[]; next?: string };
      setOlder((prev) => [...prev, ...(data.events ?? [])]);
      setNextCursor(data.next ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function backToLive() {
    setOlder([]);
    setNextCursor("");
  }

  const csvHref = (() => {
    const params = queryParams();
    params.set("format", "csv");
    return `/v1/query/events?${params.toString()}`;
  })();

  // An incident is a slice of a session. A server-side event has no session, so
  // there is nothing to cue a replay to and no incident to open.
  const isIncidentable = (e: Event) =>
    (e.type === "error" || e.type === "bug_report") && !!e.session_id;

  // Live page first, then any history paged in below it.
  const rows = browsing ? [...events, ...older] : events;

  const userCount = new Set(rows.map((e) => e.user_id)).size;
  const errorCount = rows.filter((e) => e.type === "error" || e.type === "bug_report").length;
  const spark = minuteBuckets(rows);

  return (
    <div>
      <h2>
        Live feed{" "}
        {error ? (
          <span class="muted">· paused</span>
        ) : browsing ? (
          <span class="muted">· paused while browsing history</span>
        ) : (
          <span class="live-tag">
            <span class="live-dot" /> live
          </span>
        )}
      </h2>

      <StatStrip>
        <StatTile label="events · shown" value={rows.length} spark={spark} accent="event" />
        <StatTile label="active users" value={userCount} accent="pageview" />
        <StatTile label="errors" value={errorCount} accent="error" />
      </StatStrip>

      <div class="toolbar">
        <input
          placeholder="user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <div class="seg" role="group" aria-label="Event type">
          {SEG_OPTIONS.map((o) => {
            const n =
              o.value === ""
                ? Object.entries(counts)
                    .filter(([t]) => !NOISY_TYPES.includes(t))
                    .reduce((sum, [, c]) => sum + c, 0)
                : (counts[o.value] ?? 0);
            return (
              <button
                key={o.value}
                type="button"
                class={`seg-btn${filterType === o.value ? " active" : ""}`}
                aria-pressed={filterType === o.value}
                onClick={() => setFilterType(o.value)}
              >
                {o.color && <span class="seg-dot" style={`background:${o.color}`} />}
                {o.label}
                {n > 0 && <span class="seg-count">{n.toLocaleString()}</span>}
              </button>
            );
          })}
        </div>
        <input
          placeholder="app"
          value={filterApp}
          onInput={(e) => setFilterApp((e.target as HTMLInputElement).value)}
        />
        {/* Same query string as the feed, so the file is the view on screen. */}
        <a class="btn-link" href={csvHref} download title="Download this view as CSV">
          <Icon name="chevron-right" size={14} /> CSV
        </a>
      </div>
      {filterType === "" && (counts.network ?? 0) > 0 && (
        <p class="filter-note">
          Showing what people did. {counts.network!.toLocaleString()} network request
          {counts.network === 1 ? "" : "s"} in this window {counts.network === 1 ? "is" : "are"}{" "}
          hidden —{" "}
          <button type="button" class="linkish" onClick={() => setFilterType("network")}>
            show them
          </button>
          .
        </p>
      )}
      {error && <div style="color:var(--red);margin-bottom:1rem">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>type</th>
            <th>user</th>
            <th>name</th>
            <th>url</th>
            <th>props</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COL_COUNT}>
                <div class="empty-state">
                  <Icon name="inbox" size={28} />
                  <p>no events yet — run the SDK and start capturing</p>
                </div>
              </td>
            </tr>
          )}
          {rows.map((e) => {
            const clickable = isIncidentable(e);
            const cls = [clickable ? "row-clickable" : "", newIds.has(e.id) ? "row-new" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <tr
                key={e.id}
                class={cls}
                title={clickable ? "Open incident view" : undefined}
                {...(clickable
                  ? rowButton(() => onOpenIncident(e.id), `Open incident: ${e.name}`)
                  : {})}
              >
                <td class="ts">{fmtTs(e.ts)}</td>
                <td>
                  <span class={`badge ${TYPE_BADGES[e.type] ?? "badge-event"}`}>{e.type}</span>
                </td>
                <td>
                  <span style="display:flex;align-items:center;gap:6px">
                    <Avatar id={e.user_id} size={18} />
                    <UserLink id={e.user_id} range={range.key} />
                  </span>
                </td>
                <td>{e.name}</td>
                <td class="muted">{e.url ?? ""}</td>
                <td class="props">
                  <PropsChips props={e.props} max={3} />
                </td>
                {clickable ? (
                  <td class="row-chevron">
                    <Icon name="chevron-right" />
                  </td>
                ) : (
                  <td class="row-chevron" />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div class="pager">
        {nextCursor ? (
          <button type="button" onClick={loadOlder} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Older events"}
          </button>
        ) : (
          rows.length > 0 && <span class="ts">End of this window.</span>
        )}
        {browsing && (
          <button type="button" class="linkish" onClick={backToLive}>
            back to live
          </button>
        )}
      </div>
    </div>
  );
}
