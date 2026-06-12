import { useState } from "preact/hooks";
import { LiveFeed } from "./views/LiveFeed.js";

type View = "live";

export function App() {
  const [view] = useState<View>("live");

  return (
    <>
      <nav>
        <span class="logo">spyglass</span>
        <a href="#" class="active">Live feed</a>
      </nav>
      <main>
        <div id="app">
          {view === "live" && <LiveFeed />}
        </div>
      </main>
    </>
  );
}
