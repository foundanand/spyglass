// "Save this view" — the control that turns a configured panel into something
// that survives the tab closing.
//
// It sends exactly the parameters the panel is already using. That is the whole
// design: a saved view is a name attached to a parameter set the endpoint
// already accepts, so this can never save a question the dashboard could not
// otherwise ask.

import { useState } from "preact/hooks";
import { Icon } from "./Icon.js";

export function SaveView({
  kind,
  params,
  suggestedName,
}: {
  kind: "flows" | "funnel" | "aggregates" | "events";
  /** Exactly what the panel passes to its endpoint, minus the time window. */
  params: Record<string, string>;
  suggestedName: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    const name = prompt("Name this view", suggestedName);
    if (!name?.trim()) return;
    setState("saving");
    try {
      const res = await fetch("/v1/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, params }),
      });
      setState(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" class="linkish save-view" onClick={save} disabled={state === "saving"}>
      <Icon name="chevron-right" size={12} />{" "}
      {state === "saved" ? (
        <>
          saved — <a href="#/boards">add to a board</a>
        </>
      ) : state === "error" ? (
        "could not save"
      ) : state === "saving" ? (
        "saving…"
      ) : (
        "save this view"
      )}
    </button>
  );
}
