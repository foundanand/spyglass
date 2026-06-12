import { useState } from "preact/hooks";
import { LiveFeed } from "./views/LiveFeed.js";
import { ReplayPlayer } from "./views/ReplayPlayer.js";
import { UserTimeline } from "./views/UserTimeline.js";
import { Errors } from "./views/Errors.js";
import { Incident } from "./views/Incident.js";

type View = "live" | "timeline" | "errors" | "replay" | "incident";

export function App() {
  const [view, setView] = useState<View>("live");
  const [incidentId, setIncidentId] = useState<number | null>(null);

  function openIncident(id: number) {
    setIncidentId(id);
    setView("incident");
  }

  function backFromIncident() {
    setView("errors");
    setIncidentId(null);
  }

  return (
    <>
      <nav>
        <span class="logo">spyglass</span>
        <a
          href="#"
          class={view === "live" ? "active" : ""}
          onClick={(e) => { e.preventDefault(); setView("live"); }}
        >
          Live feed
        </a>
        <a
          href="#"
          class={view === "timeline" ? "active" : ""}
          onClick={(e) => { e.preventDefault(); setView("timeline"); }}
        >
          Timeline
        </a>
        <a
          href="#"
          class={view === "errors" || view === "incident" ? "active" : ""}
          onClick={(e) => { e.preventDefault(); setView("errors"); setIncidentId(null); }}
        >
          Errors
        </a>
        <a
          href="#"
          class={view === "replay" ? "active" : ""}
          onClick={(e) => { e.preventDefault(); setView("replay"); }}
        >
          Replay
        </a>
      </nav>
      <main>
        <div id="app">
          {view === "live" && <LiveFeed onOpenIncident={openIncident} />}
          {view === "timeline" && <UserTimeline />}
          {view === "errors" && <Errors onOpenIncident={openIncident} />}
          {view === "replay" && <ReplayPlayer />}
          {view === "incident" && incidentId !== null && (
            <Incident eventId={incidentId} onBack={backFromIncident} />
          )}
        </div>
      </main>
    </>
  );
}
