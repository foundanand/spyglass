import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { Avatar } from "../components/Avatar.js";
import { StatTile, StatStrip } from "../components/StatTile.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { rowButton } from "../components/rowProps.js";
import { SessionLink, UserLink } from "../components/EntityLink.js";
import { applyRange, type TimeRange } from "../range.js";

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

interface ErrorsProps {
  onOpenIncident: (id: number) => void;
  range: TimeRange;
}

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

function StackRow({ stack }: { stack?: unknown }) {
  const [open, setOpen] = useState(false);
  if (!stack || typeof stack !== "string") return null;
  return (
    <>
      <button
        class="stack-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? "▲ hide" : "▼ stack"}
      </button>
      {open && <pre class="stack-trace">{stack}</pre>}
    </>
  );
}

export function Errors({ onOpenIncident, range }: ErrorsProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");
  const [typeFilter, setTypeFilter] = useState<"error" | "bug_report" | "">("error");
  const [nextCursor, setNextCursor] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  /** Filters shared by the table and its CSV export. */
  function queryParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (filterUser) params.set("user", filterUser);
    applyRange(params, range);
    return params;
  }

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      const params = queryParams();
      params.set("limit", "200");
      const res = await fetch(`/v1/query/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { events: Event[]; next?: string };
      setEvents(d.events ?? []);
      setNextCursor(d.next ?? "");
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filterUser, typeFilter, range.key]);

  async function loadOlder() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = queryParams();
      params.set("limit", "200");
      params.set("cursor", nextCursor);
      const res = await fetch(`/v1/query/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { events: Event[]; next?: string };
      setEvents((prev) => [...prev, ...(d.events ?? [])]);
      setNextCursor(d.next ?? "");
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const csvHref = (() => {
    const params = queryParams();
    params.set("format", "csv");
    return `/v1/query/events?${params.toString()}`;
  })();

  const errorCount = events.filter((e) => e.type === "error").length;
  const reportCount = events.filter((e) => e.type === "bug_report").length;
  const usersAffected = new Set(events.map((e) => e.user_id)).size;

  return (
    <div>
      <h2>Errors &amp; Reports</h2>
      <StatStrip>
        <StatTile label="errors" value={errorCount} accent="error" />
        <StatTile label="reports" value={reportCount} accent="bug" />
        <StatTile label="users affected" value={usersAffected} accent="accent" />
      </StatStrip>
      <div class="toolbar">
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter((e.target as HTMLSelectElement).value as typeof typeFilter)
          }
        >
          <option value="error">errors</option>
          <option value="bug_report">bug reports</option>
          <option value="">both</option>
        </select>
        <input
          placeholder="filter by user id"
          value={filterUser}
          onInput={(e) => setFilterUser((e.target as HTMLInputElement).value)}
        />
        <button onClick={load}>
          <Icon name="refresh" /> Refresh
        </button>
        {/* Same query string as the table, so the file is the view on screen. */}
        <a class="btn-link" href={csvHref} download title="Download this view as CSV">
          <Icon name="chevron-right" size={14} /> CSV
        </a>
        {loading && <span class="ts">Loading…</span>}
      </div>
      {fetchError && <div style="color:var(--red);margin-bottom:1rem">{fetchError}</div>}
      {loading && events.length === 0 && <SkeletonRows rows={4} />}
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>type</th>
            <th>user</th>
            <th>message</th>
            <th>source</th>
            <th>session</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && !loading && (
            <tr>
              <td colSpan={7}>
                <div class="empty-state">
                  <Icon
                    name={
                      typeFilter === "error"
                        ? "error"
                        : typeFilter === "bug_report"
                          ? "bug"
                          : "inbox"
                    }
                    size={24}
                  />
                  <p>no events — throw something or submit a report</p>
                </div>
              </td>
            </tr>
          )}
          {events.map((e) => (
            <tr
              key={e.id}
              class={`row-clickable ${e.type === "bug_report" ? "row-bug_report" : "row-error"}`}
              title="Open incident view"
              {...rowButton(() => onOpenIncident(e.id), `Open incident: ${e.name}`)}
            >
              <td class="ts">{fmtTs(e.ts)}</td>
              <td>
                <span class={`badge badge-${e.type}`}>
                  {e.type === "bug_report" ? "report" : "error"}
                </span>
              </td>
              <td>
                <span style="display:inline-flex;align-items:center;gap:6px">
                  <Avatar id={e.user_id} size={18} />
                  <UserLink id={e.user_id} range={range.key} />
                </span>
              </td>
              <td class="err-msg">
                <span class="err-name">{e.name}</span>
                {e.type === "error" && <StackRow stack={e.props?.stack} />}
                {e.type === "bug_report" && e.props?.severity && (
                  <span class="severity-inline">{String(e.props.severity)}</span>
                )}
              </td>
              <td class="ts">{String(e.props?.source ?? e.url ?? "")}</td>
              <td class="ts">
                <SessionLink id={e.session_id} range={range.key} />
              </td>
              <td class="row-chevron">
                <Icon name="chevron-right" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div class="pager">
        {nextCursor ? (
          <button type="button" onClick={loadOlder} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Older"}
          </button>
        ) : (
          events.length > 0 && <span class="ts">End of this window.</span>
        )}
      </div>
    </div>
  );
}
