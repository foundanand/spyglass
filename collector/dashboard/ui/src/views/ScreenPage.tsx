// The screen page.
//
// "Top pages" was a leaderboard: a path next to a count, and nothing else. The
// question it raises — what actually happens on this screen — was unanswerable
// without reading URLs by hand.
//
// This is the weakest of the three entity pages by design; "errors on this
// screen" is the part that earns it.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";
import { RelTime } from "../components/RelTime.js";
import { SkeletonRows } from "../components/Skeleton.js";
import { SessionLink, UserLink } from "../components/EntityLink.js";
import { applyRange, type TimeRange } from "../range.js";

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

export function ScreenPage({ path, range }: { path: string; range: TimeRange }) {
  const [events, setEvents] = useState<SpyEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = applyRange(new URLSearchParams({ screen: path, limit: "500" }), range);
    fetch(`/v1/query/events?${params}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setEvents(d.events ?? []))
      .catch(() => !cancelled && setEvents([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, range.key]);

  const views = events.filter((e) => e.type === "pageview");
  const errors = events.filter((e) => e.type === "error" || e.type === "bug_report");
  const people = new Set(views.map((e) => e.user_id));
  const sessions = new Map<string, SpyEvent>();
  for (const e of views) if (!sessions.has(e.session_id)) sessions.set(e.session_id, e);

  return (
    <div>
      <nav class="crumbs">
        <a href="#/behaviour">Behaviour</a> <span>/</span> <strong>{path}</strong>
      </nav>
      <h2>
        <Icon name="network" size={16} /> {path}
      </h2>

      {loading && <SkeletonRows rows={3} />}

      {!loading && (
        <>
          <div class="home-tiles">
            <div class="home-tile">
              <span class="home-tile-label">views</span>
              <span class="home-tile-value">{views.length}</span>
              <span class="home-tile-foot">in this window</span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">people</span>
              <span class="home-tile-value">{people.size}</span>
              <span class="home-tile-foot">distinct visitors</span>
            </div>
            <div class="home-tile">
              <span class="home-tile-label">problems here</span>
              <span class="home-tile-value">{errors.length}</span>
              <span class="home-tile-foot">errors and reports</span>
            </div>
          </div>

          <section class="home-card">
            <h3>What broke here</h3>
            {errors.length === 0 ? (
              <p class="home-empty">Nothing has gone wrong on this screen in this window.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>when</th>
                    <th>type</th>
                    <th>what</th>
                    <th>person</th>
                    <th>session</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
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
                        <UserLink id={e.user_id} range={range.key} />
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

          <section class="home-card">
            <h3>Recent sessions that visited</h3>
            {sessions.size === 0 ? (
              <p class="home-empty">No visits in this window.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>when</th>
                    <th>person</th>
                    <th>session</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sessions.values()].slice(0, 25).map((e) => (
                    <tr key={e.session_id}>
                      <td class="ts">
                        <RelTime ts={e.ts} />
                      </td>
                      <td>
                        <UserLink id={e.user_id} range={range.key} />
                      </td>
                      <td>
                        <SessionLink id={e.session_id} range={range.key}>
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
