import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LiveFeed } from "./views/LiveFeed.js";
import { ReplayPlayer } from "./views/ReplayPlayer.js";
import { UserTimeline } from "./views/UserTimeline.js";
import { Errors } from "./views/Errors.js";
import { Incident } from "./views/Incident.js";
import { Insights } from "./views/Insights.js";
import { Icon } from "./components/Icon.js";

type View = "live" | "timeline" | "errors" | "replay" | "insights" | "incident";

interface Route {
  view: View;
  param?: string;
}

const TITLES: Record<View, string> = {
  live: "live feed",
  timeline: "timeline",
  errors: "errors",
  replay: "replay",
  insights: "insights",
  incident: "incident",
};

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [seg, param] = h.split("/");
  switch (seg) {
    case "timeline": return { view: "timeline", param };
    case "errors": return { view: "errors" };
    case "replay": return { view: "replay", param };
    case "insights": return { view: "insights" };
    case "incident": return { view: "incident", param };
    case "live":
    case "":
    default: return { view: "live" };
  }
}

const NAV: { view: View; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { view: "live", label: "Live feed", icon: "clock" },
  { view: "timeline", label: "Timeline", icon: "user" },
  { view: "errors", label: "Errors", icon: "error" },
  { view: "replay", label: "Replay", icon: "play" },
  { view: "insights", label: "Insights", icon: "network" },
];

export function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route.view]} — spyglass`;
  }, [route.view]);

  const go = (hash: string) => { window.location.hash = hash; };
  const openIncident = (id: number) => go(`/incident/${id}`);

  const { view, param } = route;
  const navActive = view === "incident" ? "errors" : view;

  // Position the sliding underline under the active nav item.
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>("a.active");
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [navActive]);

  return (
    <>
      <nav ref={navRef}>
        <span class="logo"><Icon name="search" size={16} /> spyglass</span>
        {NAV.map((n) => (
          <a
            key={n.view}
            href={`#/${n.view}`}
            class={navActive === n.view ? "active" : ""}
            onClick={(e) => { e.preventDefault(); go(`/${n.view}`); }}
          >
            {n.label}
          </a>
        ))}
        <span class="nav-ind" style={`left:${ind.left}px;width:${ind.width}px`} />
      </nav>
      <main>
        <div id="app">
          <div class="view" key={`${view}/${param ?? ""}`}>
            {view === "live" && <LiveFeed onOpenIncident={openIncident} />}
            {view === "timeline" && <UserTimeline />}
            {view === "errors" && <Errors onOpenIncident={openIncident} />}
            {view === "replay" && <ReplayPlayer key={param ?? "all"} initialSessionId={param} />}
            {view === "insights" && <Insights />}
            {view === "incident" && param && (
              <Incident
                key={param}
                eventId={Number(param)}
                onBack={() => go("/errors")}
              />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
