import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LiveFeed } from "./views/LiveFeed.js";
import { ReplayPlayer } from "./views/ReplayPlayer.js";
import { UserTimeline } from "./views/UserTimeline.js";
import { Errors } from "./views/Errors.js";
import { Incident } from "./views/Incident.js";
import { Behaviour } from "./views/Behaviour.js";
import { Home } from "./views/Home.js";
import { FlowPage } from "./views/FlowPage.js";
import { UserPage } from "./views/UserPage.js";
import { ScreenPage } from "./views/ScreenPage.js";
import { Setup } from "./views/Setup.js";
import { Boards } from "./views/Boards.js";
import { Icon } from "./components/Icon.js";
import { DEFAULT_RANGE, isRangeKey, RANGES, resolveRange, type RangeKey } from "./range.js";

// Views are named after the job they do, not after how the data is stored.
//
// The old nav was five flat peers — Live feed, Timeline, Errors, Replay,
// Insights — three of which were the same query with different filters, all
// presented as equal destinations. And it opened on the raw event stream, which
// is the rawest view in the product and ~89% network noise on real data.
//
// Nothing was removed in the regrouping; Explore is the old live feed, kept
// last and plainly labelled as the escape hatch rather than the front door.
type View =
  | "home"
  | "behaviour"
  | "sessions"
  | "issues"
  | "explore"
  | "boards"
  | "replay"
  | "incident"
  | "flow"
  | "user"
  | "screen";

interface Route {
  view: View;
  param?: string;
  range: RangeKey;
  /** Explore's type filter. "" = activity (everything except network). */
  type: string;
  /** Explicit window from a drill-down, overriding the preset. */
  from?: number;
  to?: number;
}

const TITLES: Record<View, string> = {
  home: "home",
  behaviour: "behaviour",
  sessions: "sessions",
  issues: "issues",
  explore: "explore",
  boards: "boards",
  replay: "replay",
  incident: "incident",
  flow: "flow",
  user: "user",
  screen: "screen",
};

// #/behaviour?range=7d — state lives in the hash so a view is shareable,
// survives a reload, and a drill-down can carry its context.
function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, queryStr = ""] = raw.split("?");
  const query = new URLSearchParams(queryStr);
  const range: RangeKey = isRangeKey(query.get("range"))
    ? (query.get("range") as RangeKey)
    : DEFAULT_RANGE;
  const type = query.get("type") ?? "";
  const from = query.get("from") ? Number(query.get("from")) : undefined;
  const to = query.get("to") ? Number(query.get("to")) : undefined;

  const [seg, ...rest] = path.split("/");
  const param = rest.length > 0 ? decodeURIComponent(rest.join("/")) : undefined;
  const base = { range, type, from, to };

  switch (seg) {
    case "behaviour":
      return { view: "behaviour", ...base };
    case "sessions":
      return { view: "sessions", param, ...base };
    case "issues":
      return { view: "issues", ...base };
    case "explore":
      return { view: "explore", ...base };
    case "boards":
      return { view: "boards", param, ...base };
    case "replay":
      return { view: "replay", param, ...base };
    case "incident":
      return { view: "incident", param, ...base };
    case "flow":
      return { view: "flow", param, ...base };
    case "user":
      return { view: "user", param, ...base };
    case "screen":
      return { view: "screen", param, ...base };
    case "home":
    case "":
    default:
      return { view: "home", ...base };
  }
}

/** Build a hash preserving the current window (and Explore's filter). */
function hashFor(path: string, range: RangeKey, type = ""): string {
  const q = new URLSearchParams();
  if (range !== DEFAULT_RANGE) q.set("range", range);
  if (type) q.set("type", type);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const NAV: { view: View; label: string; icon: Parameters<typeof Icon>[0]["name"]; hint: string }[] =
  [
    { view: "home", label: "Home", icon: "search", hint: "Is everything OK?" },
    { view: "behaviour", label: "Behaviour", icon: "network", hint: "What are people doing?" },
    { view: "sessions", label: "Sessions", icon: "user", hint: "Who did it?" },
    { view: "issues", label: "Issues", icon: "error", hint: "What broke?" },
    { view: "boards", label: "Boards", icon: "network", hint: "Saved views you check regularly" },
    { view: "explore", label: "Explore", icon: "clock", hint: "The raw event stream" },
  ];

/** Which nav item a detail view belongs under. */
const NAV_PARENT: Partial<Record<View, View>> = {
  incident: "issues",
  replay: "sessions",
  user: "sessions",
  flow: "behaviour",
  screen: "behaviour",
};

interface Meta {
  version: string;
  apps: string[];
  has_any_events: boolean;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  // undefined = not yet known; the nav is held back until then so a fresh
  // install does not flash five empty tabs before the setup panel appears.
  const [meta, setMeta] = useState<Meta | undefined>(undefined);

  useEffect(() => {
    fetch("/v1/query/meta")
      .then((r) => r.json())
      .then(setMeta)
      // If meta is unreachable, fall through to the normal dashboard rather
      // than trapping the user on a setup screen for a request that failed.
      .catch(() => setMeta({ version: "", apps: [], has_any_events: true }));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route.view]} — spyglass`;
  }, [route.view]);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const { view, param, range: rangeKey, type, from, to } = route;
  // A drill-down can pin an explicit window (a day from a chart, say); the
  // preset is the fallback rather than the only option.
  const preset = resolveRange(rangeKey);
  const range = from !== undefined ? { ...preset, from, to, label: "selected period" } : preset;
  const here = `/${view}${param ? `/${encodeURIComponent(param)}` : ""}`;

  const openIncident = (id: number) => go(hashFor(`/incident/${id}`, rangeKey));
  const setRange = (key: RangeKey) => go(hashFor(here, key, type));
  const setType = (t: string) => go(hashFor(here, rangeKey, t));

  const navActive = NAV_PARENT[view] ?? view;

  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>("a.active");
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [navActive]);

  // Nothing has ever arrived: this is a setup problem, not an empty window, and
  // the terse "no activity yet" is the least useful thing to say about it.
  if (meta && !meta.has_any_events) {
    return (
      <main>
        <div id="app">
          <Setup meta={meta} onArrived={() => setMeta({ ...meta, has_any_events: true })} />
        </div>
      </main>
    );
  }

  return (
    <>
      <nav ref={navRef}>
        <span class="logo">
          <Icon name="search" size={16} /> spyglass
        </span>
        {NAV.map((n) => (
          <a
            key={n.view}
            href={`#${hashFor(`/${n.view}`, rangeKey)}`}
            class={navActive === n.view ? "active" : ""}
            title={n.hint}
            onClick={(e) => {
              e.preventDefault();
              go(hashFor(`/${n.view}`, rangeKey));
            }}
          >
            {n.label}
          </a>
        ))}
        <span class="nav-ind" style={`left:${ind.left}px;width:${ind.width}px`} />
        <div class="range-picker" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              class={rangeKey === r.key && from === undefined ? "active" : ""}
              aria-pressed={rangeKey === r.key && from === undefined}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </nav>
      <main>
        <div id="app">
          <div class="view" key={`${view}/${param ?? ""}`}>
            {view === "home" && <Home range={range} />}
            {view === "behaviour" && <Behaviour range={range} />}
            {view === "sessions" && <UserTimeline range={range} />}
            {view === "issues" && <Errors onOpenIncident={openIncident} range={range} />}
            {view === "boards" && <Boards range={range} boardId={param} />}
            {view === "explore" && (
              <LiveFeed
                onOpenIncident={openIncident}
                range={range}
                type={type}
                onTypeChange={setType}
              />
            )}
            {view === "replay" && (
              <ReplayPlayer key={param ?? "all"} initialSessionId={param} range={range} />
            )}
            {view === "flow" && param && <FlowPage key={param} name={param} range={range} />}
            {view === "user" && param && <UserPage key={param} id={param} range={range} />}
            {view === "screen" && param && <ScreenPage key={param} path={param} range={range} />}
            {view === "incident" && param && (
              <Incident
                key={param}
                eventId={Number(param)}
                onBack={() => {
                  // Back should return where you came from, not always Issues.
                  if (window.history.length > 1) window.history.back();
                  else go(hashFor("/issues", rangeKey));
                }}
              />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
