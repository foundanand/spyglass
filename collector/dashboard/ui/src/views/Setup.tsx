// The first-run panel.
//
// A freshly started collector shows "no activity yet" on every view, which is
// indistinguishable from a broken install. First-run is where a self-hosted
// tool gets abandoned: the operator has already run a binary, written a config
// and wired an SDK, and the payoff screen looks like failure. There is no
// support channel to ask and no error to search for.
//
// So the empty state becomes the last step of setup. Not a wizard — a checklist
// that answers "why is this empty", with the snippet pre-filled from what this
// collector is actually configured for, so it cannot be mistyped.

import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.js";

interface Meta {
  version: string;
  apps: string[];
  has_any_events: boolean;
}

function Copyable({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="setup-block">
      <div class="setup-block-head">
        <span>{label}</span>
        <button
          type="button"
          class="linkish"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {
                /* clipboard blocked — the text is on screen anyway */
              },
            );
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre class="setup-code">{code}</pre>
    </div>
  );
}

export function Setup({ meta, onArrived }: { meta: Meta; onArrived: () => void }) {
  const [waiting, setWaiting] = useState(true);

  // Poll until the first event lands, then hand back to the real dashboard.
  // Confirmation should arrive on its own — asking someone to reload to find
  // out whether their integration works is the same non-answer as before.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      fetch("/v1/query/meta")
        .then((r) => r.json())
        .then((m: Meta) => {
          if (m.has_any_events) {
            setWaiting(false);
            onArrived();
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [waiting]);

  const origin = window.location.origin;
  const app = meta.apps[0] ?? "your-app";

  const snippet = `import { spyglass } from "@spyglass/sdk";

spyglass.init({
  endpoint: "${origin}",
  app: "${app}",
  key: "…",            // apps.${app}.key from your collector config
  user: { id: currentUser.id },
});`;

  const csp = `connect-src 'self' ${origin};`;

  return (
    <div class="setup">
      <h2>
        <Icon name="search" size={16} /> Waiting for your first event
      </h2>
      <p class="setup-lede">
        The collector is running and configured. Nothing has posted to it yet — these are the three
        things that usually explain that.
      </p>

      <ol class="setup-steps">
        <li class="setup-step done">
          <span class="setup-tick">✓</span>
          <div>
            <strong>The collector is up.</strong>
            <p>
              spyglassd <code>{meta.version}</code>, serving this page on <code>{origin}</code>
              {meta.apps.length > 0 ? (
                <>
                  , configured for{" "}
                  {meta.apps.map((a, i) => (
                    <>
                      {i > 0 && ", "}
                      <code key={a}>{a}</code>
                    </>
                  ))}
                  .
                </>
              ) : (
                <>
                  . <strong>No apps are configured</strong> — add one under <code>apps</code> in
                  your config file and restart.
                </>
              )}
            </p>
          </div>
        </li>

        <li class="setup-step">
          <span class="setup-tick pending">2</span>
          <div>
            <strong>Initialise the SDK in your app.</strong>
            <p>
              Already filled in with this collector&rsquo;s address and app slug, so they cannot be
              mistyped. The key is the one thing only you have.
            </p>
            <Copyable label="app entry point" code={snippet} />
          </div>
        </li>

        <li class="setup-step">
          <span class="setup-tick pending">3</span>
          <div>
            <strong>Allow the collector in your Content-Security-Policy.</strong>
            <p>
              This is the most likely reason a correct-looking install shows nothing. A{" "}
              <code>connect-src</code> that omits this origin makes the browser block every POST{" "}
              <em>silently</em> — no console error, no failed request your app can see.
            </p>
            <Copyable label="content-security-policy" code={csp} />
          </div>
        </li>
      </ol>

      <p class="setup-waiting">
        <span class="live-dot" /> Watching for the first event — this page will move on by itself
        the moment one arrives.
      </p>

      <p class="setup-foot">
        Full instructions in <strong>docs/getting-started</strong>. If events still do not appear,
        check the collector&rsquo;s log: an app slug or key mismatch is rejected with a{" "}
        <code>401</code>, and a disallowed origin with a <code>403</code>.
      </p>
    </div>
  );
}
