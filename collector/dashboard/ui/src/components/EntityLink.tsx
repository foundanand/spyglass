// Links to the nouns that have pages.
//
// These exist so that linking is the *default* rather than something each view
// has to remember. Before entity pages, a user id rendered in a flow breakdown,
// an error row and a session row was inert text in all three places — the tool
// had one cross-view link in the entire product.
//
// They are real anchors, not divs with handlers, so keyboard and screen-reader
// users get the same paths and the browser gives back-navigation for free.

import type { RangeKey } from "../range.js";

/** Build a hash that preserves the current window. */
function withRange(path: string, range: RangeKey | undefined): string {
  return range && range !== "30d" ? `#${path}?range=${range}` : `#${path}`;
}

// These links often sit inside table rows that are themselves controls (a row
// that opens an incident, say). Without this, clicking the user link would also
// fire the row and you would land somewhere you did not choose.
const stop = (e: Event) => e.stopPropagation();

export function UserLink({
  id,
  range,
  children,
}: {
  id: string;
  range?: RangeKey;
  children?: unknown;
}) {
  if (!id) return <span class="muted">—</span>;
  return (
    <a
      class="entity-link"
      onClick={stop}
      href={withRange(`/user/${encodeURIComponent(id)}`, range)}
      title={`Open ${id}`}
    >
      {children ?? id}
    </a>
  );
}

export function FlowLink({
  name,
  range,
  children,
}: {
  name: string;
  range?: RangeKey;
  children?: unknown;
}) {
  if (!name) return <span class="muted">—</span>;
  return (
    <a
      class="entity-link"
      onClick={stop}
      href={withRange(`/flow/${encodeURIComponent(name)}`, range)}
      title={`Open ${name}`}
    >
      {children ?? name}
    </a>
  );
}

export function ScreenLink({
  path,
  range,
  children,
}: {
  path: string;
  range?: RangeKey;
  children?: unknown;
}) {
  if (!path) return <span class="muted">—</span>;
  return (
    <a
      class="entity-link"
      onClick={stop}
      href={withRange(`/screen/${encodeURIComponent(path)}`, range)}
      title={`Open ${path}`}
    >
      {children ?? path}
    </a>
  );
}

/** A session id that opens its replay. Every session leads to a recording. */
export function SessionLink({
  id,
  range,
  children,
}: {
  id: string;
  range?: RangeKey;
  children?: unknown;
}) {
  if (!id)
    return (
      <span class="muted" title="no session (server-side event)">
        —
      </span>
    );
  return (
    <a
      class="entity-link"
      onClick={stop}
      href={withRange(`/replay/${encodeURIComponent(id)}`, range)}
      title="Watch this session"
    >
      {children ?? `${id.slice(0, 12)}…`}
    </a>
  );
}
