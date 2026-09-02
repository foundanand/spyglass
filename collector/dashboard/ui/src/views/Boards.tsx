// Saved views and boards.
//
// Every question asked of spyglass used to be thrown away when the tab closed.
// The flows panel and the funnel builder both take real input and neither could
// be named, saved or put next to another one — so the tool answered questions
// but never accumulated. There was no "the four numbers we check every Monday",
// and no way to hand somebody a view rather than instructions for recreating it.
//
// This is persistence and layout, not expressiveness. A saved view is a name
// attached to a parameter set the existing endpoints already accept; nothing
// here can ask a question the dashboard could not already ask.
//
// Views are global. The collector has one shared password and no user model,
// which is right for a 20-200 person tool — adding a user model so somebody
// could have a private favourite would be the tail wagging the dog.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { FlowLink } from "../components/EntityLink.js";
import { applyRange, tzOffsetMinutes, type TimeRange } from "../range.js";
import { fmtDuration } from "./Flows.js";

type ViewKind = "flows" | "funnel" | "aggregates" | "events";

interface SavedView {
  id: number;
  name: string;
  kind: ViewKind;
  params: Record<string, string>;
  created_at: number;
  updated_at: number;
}

interface Board {
  id: number;
  name: string;
  created_at: number;
  views: SavedView[];
}

const KIND_LABEL: Record<ViewKind, string> = {
  flows: "Flow durations",
  funnel: "Funnel",
  aggregates: "Aggregates",
  events: "Events",
};

/** Map a saved view onto the endpoint it wraps. No new query capability. */
function endpointFor(v: SavedView, range: TimeRange): string {
  const params = new URLSearchParams();
  for (const [k, val] of Object.entries(v.params ?? {})) {
    if (val !== "" && val != null) params.set(k, String(val));
  }
  // A board inherits the global window rather than pinning its own, so every
  // panel on it is comparable. A saved view that pinned dates would quietly
  // answer a different question from the one next to it.
  applyRange(params, range);
  if (v.kind === "aggregates") params.set("tz", String(tzOffsetMinutes()));
  const path = v.kind === "funnel" ? "funnel" : v.kind === "events" ? "events" : v.kind;
  return `/v1/query/${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// One rendered panel
// ---------------------------------------------------------------------------

function Panel({
  view,
  range,
  onRemove,
}: {
  view: SavedView;
  range: TimeRange;
  onRemove?: () => void;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(endpointFor(view, range))
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [view.id, view.updated_at, range.key]);

  return (
    <section class="home-card board-panel">
      <h3>
        {view.name}
        <span class="board-kind">{KIND_LABEL[view.kind]}</span>
        {onRemove && (
          <button type="button" class="linkish board-remove" onClick={onRemove}>
            remove
          </button>
        )}
      </h3>
      {err && <p class="home-empty">Could not load: {err}</p>}
      {!err && !data && <SkeletonRows rows={2} />}
      {!err && data && <PanelBody view={view} data={data} range={range} />}
    </section>
  );
}

function PanelBody({
  view,
  data,
  range,
}: {
  view: SavedView;
  data: Record<string, unknown>;
  range: TimeRange;
}) {
  if (view.kind === "flows") {
    const flows = (data.flows ?? []) as {
      name: string;
      group?: string;
      completions: number;
      abandon_rate: number;
      p50_ms: number;
      p90_ms: number;
    }[];
    if (flows.length === 0) return <p class="home-empty">No runs in this window.</p>;
    return (
      <table>
        <caption class="sr-only">{view.name}</caption>
        <thead>
          <tr>
            <th scope="col">{flows[0].group !== undefined ? "group" : "flow"}</th>
            <th scope="col">runs</th>
            <th scope="col">median</th>
            <th scope="col">p90</th>
            <th scope="col">gave up</th>
          </tr>
        </thead>
        <tbody>
          {flows.slice(0, 8).map((f, i) => (
            <tr key={i}>
              <td>
                {f.group !== undefined ? (
                  f.group || "unknown"
                ) : (
                  <FlowLink name={f.name} range={range.key} />
                )}
              </td>
              <td>{f.completions}</td>
              <td>{fmtDuration(f.p50_ms)}</td>
              <td>{fmtDuration(f.p90_ms)}</td>
              <td>{Math.round(f.abandon_rate * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (view.kind === "funnel") {
    const steps = (data.steps ?? []) as {
      name: string;
      count: number;
      from_prev?: { p50_ms: number } | null;
    }[];
    if (steps.length === 0) return <p class="home-empty">No data for these steps.</p>;
    const top = Math.max(steps[0]?.count ?? 1, 1);
    return (
      <div class="funnel">
        {steps.map((s, i) => (
          <div key={i} class="funnel-step">
            <div class="funnel-head">
              <span class="funnel-name">
                {i + 1}. {s.name}
              </span>
              <span class="funnel-count">{s.count}</span>
            </div>
            <div class="funnel-bar-track">
              <div class="funnel-bar-fill" style={`width:${Math.round((s.count / top) * 100)}%`} />
            </div>
            {s.from_prev && (
              <div class="funnel-timing">{fmtDuration(s.from_prev.p50_ms)} median</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (view.kind === "aggregates") {
    const dau = (data.dau ?? []) as { day: string; count: number }[];
    const errs = (data.errors_by_day ?? []) as { day: string; count: number }[];
    const users = dau.reduce((n, d) => n + d.count, 0);
    const errors = errs.reduce((n, d) => n + d.count, 0);
    return (
      <div class="home-tiles">
        <div class="home-tile">
          <span class="home-tile-label">active users</span>
          <span class="home-tile-value">{users}</span>
          <span class="home-tile-foot">daily actives, summed</span>
        </div>
        <div class="home-tile">
          <span class="home-tile-label">errors</span>
          <span class="home-tile-value">{errors}</span>
          <span class="home-tile-foot" />
        </div>
      </div>
    );
  }

  const events = (data.events ?? []) as {
    id: number;
    ts: number;
    type: string;
    name: string;
    user_id: string;
  }[];
  if (events.length === 0) return <p class="home-empty">No events in this window.</p>;
  return (
    <table>
      <caption class="sr-only">{view.name}</caption>
      <thead>
        <tr>
          <th scope="col">type</th>
          <th scope="col">name</th>
          <th scope="col">person</th>
        </tr>
      </thead>
      <tbody>
        {events.slice(0, 8).map((e) => (
          <tr key={e.id}>
            <td>
              <span class={`badge badge-${e.type}`}>{e.type}</span>
            </td>
            <td>{e.name}</td>
            <td class="ts">{e.user_id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function Boards({ range, boardId }: { range: TimeRange; boardId?: string }) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [v, b] = await Promise.all([
      fetch("/v1/views")
        .then((r) => r.json())
        .catch(() => ({ views: [] })),
      fetch("/v1/boards")
        .then((r) => r.json())
        .catch(() => ({ boards: [] })),
    ]);
    setViews(v.views ?? []);
    setBoards(b.boards ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  const active = boardId ? boards.find((b) => String(b.id) === boardId) : undefined;

  async function createBoard() {
    const name = prompt("Name this board");
    if (!name?.trim()) return;
    setBusy(true);
    await fetch("/v1/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, views: [] }),
    });
    await reload();
    setBusy(false);
  }

  async function addToBoard(board: Board, viewId: number) {
    setBusy(true);
    await fetch(`/v1/boards/${board.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ views: [...board.views.map((v) => v.id), viewId] }),
    });
    await reload();
    setBusy(false);
  }

  async function removeFromBoard(board: Board, viewId: number) {
    setBusy(true);
    await fetch(`/v1/boards/${board.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ views: board.views.filter((v) => v.id !== viewId).map((v) => v.id) }),
    });
    await reload();
    setBusy(false);
  }

  async function deleteView(id: number) {
    if (!confirm("Delete this saved view? Boards using it will drop the panel.")) return;
    setBusy(true);
    await fetch(`/v1/views/${id}`, { method: "DELETE" });
    await reload();
    setBusy(false);
  }

  if (loading) return <SkeletonRows rows={4} />;

  // ---- a single board ----
  if (active) {
    const unused = views.filter((v) => !active.views.some((bv) => bv.id === v.id));
    return (
      <div>
        <nav class="crumbs">
          <a href="#/boards">Boards</a> <span>/</span> <strong>{active.name}</strong>
        </nav>
        <h2>
          <Icon name="network" size={16} /> {active.name}
          <span class="muted" style="font-weight:400;font-size:0.8rem">
            · last {range.label.toLowerCase()}
          </span>
        </h2>

        {active.views.length === 0 ? (
          <p class="home-empty">
            This board has no panels yet. Save a view from the Behaviour page, then add it below.
          </p>
        ) : (
          <div class="home-cols">
            {active.views.map((v) => (
              <Panel
                key={v.id}
                view={v}
                range={range}
                onRemove={() => void removeFromBoard(active, v.id)}
              />
            ))}
          </div>
        )}

        {unused.length > 0 && (
          <section class="home-card">
            <h3>Add a saved view</h3>
            <div class="board-add">
              {unused.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  class="seg-btn"
                  disabled={busy}
                  onClick={() => void addToBoard(active, v.id)}
                >
                  + {v.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // ---- the index ----
  return (
    <div>
      <h2>
        <Icon name="network" size={16} /> Boards
        <span class="muted" style="font-weight:400;font-size:0.8rem">
          · the numbers you check regularly
        </span>
      </h2>

      <div class="toolbar">
        <button onClick={createBoard} disabled={busy}>
          <Icon name="chevron-right" size={14} /> New board
        </button>
      </div>

      {boards.length === 0 ? (
        <p class="home-empty">
          No boards yet. A board is a named set of saved views on one page — &ldquo;the four numbers
          we check every Monday&rdquo;.
        </p>
      ) : (
        <div class="home-cols">
          {boards.map((b) => (
            <section class="home-card" key={b.id}>
              <h3>
                <a class="entity-link" href={`#/boards/${b.id}`}>
                  {b.name}
                </a>
                <span class="board-kind">
                  {b.views.length} panel{b.views.length === 1 ? "" : "s"}
                </span>
              </h3>
              {b.views.length > 0 && (
                <ul class="home-list">
                  {b.views.map((v) => (
                    <li key={v.id}>
                      <span>{v.name}</span>
                      <span class="home-list-detail">{KIND_LABEL[v.kind]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <section class="home-card">
        <h3>Saved views</h3>
        {views.length === 0 ? (
          <p class="home-empty">
            None yet. Configure the flow table or funnel on <a href="#/behaviour">Behaviour</a> and
            press <strong>Save this view</strong>.
          </p>
        ) : (
          <table>
            <caption class="sr-only">Saved views</caption>
            <thead>
              <tr>
                <th scope="col">name</th>
                <th scope="col">kind</th>
                <th scope="col">parameters</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {views.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>
                    <span class="badge badge-event">{KIND_LABEL[v.kind]}</span>
                  </td>
                  <td class="ts">
                    {Object.entries(v.params ?? {})
                      .map(([k, val]) => `${k}=${val}`)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      class="linkish"
                      disabled={busy}
                      onClick={() => void deleteView(v.id)}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
