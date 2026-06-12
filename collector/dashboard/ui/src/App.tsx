import { useState } from "preact/hooks";
import { LiveFeed } from "./views/LiveFeed.js";
import { ReplayPlayer } from "./views/ReplayPlayer.js";

type View = "live" | "replay";

export function App() {
  const [view, setView] = useState<View>("live");

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
          class={view === "replay" ? "active" : ""}
          onClick={(e) => { e.preventDefault(); setView("replay"); }}
        >
          Replay
        </a>
      </nav>
      <main>
        <div id="app">
          {view === "live" && <LiveFeed />}
          {view === "replay" && <ReplayPlayer />}
        </div>
      </main>
    </>
  );
}
