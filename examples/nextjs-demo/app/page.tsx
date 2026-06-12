"use client";

import { VERSION } from "@spyglass/sdk";

// Phase 0: this only proves the workspace SDK import resolves. The buttons get
// wired to spyglass.capture() in Phase 1 (p1-sdk-capture / p1-sdk-next-provider).
export default function Home() {
  return (
    <main style={{ maxWidth: 640 }}>
      <h1>spyglass demo</h1>
      <p>
        SDK loaded from the workspace — version <code>{VERSION}</code>.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
        <button type="button" disabled>
          capture (wired in Phase 1)
        </button>
        <button type="button" disabled>
          report (wired in Phase 4)
        </button>
      </div>
    </main>
  );
}
