// Inline SVG icon set. All icons draw with `currentColor` so they inherit text
// color, and scale with the `size` prop. No icon font, no external assets.

export type IconName =
  | "play"
  | "pause"
  | "skip"
  | "chevron"
  | "chevron-right"
  | "error"
  | "bug"
  | "network"
  | "page"
  | "user"
  | "search"
  | "refresh"
  | "back"
  | "clock"
  | "inbox";

const PATHS: Record<IconName, preact.JSX.Element> = {
  play: <path d="M5 3.5v9l7-4.5-7-4.5Z" />,
  pause: <path d="M5 3.5h2v9H5v-9Zm4 0h2v9H9v-9Z" />,
  skip: <path d="M4 3.5v9l5-4.5-5-4.5Zm5 0v9l5-4.5-5-4.5Z" />,
  chevron: <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />,
  "chevron-right": <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />,
  error: <path d="M8 1.5 14.5 13H1.5L8 1.5Zm0 4v3.5m0 2v.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />,
  bug: <path d="M8 4a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0V6a2 2 0 0 1 2-2Zm-4 3H2m2 3H2.5m9.5-3h2m-2 3h1.5M8 2v2m-2 8-1.5 1.5M10 12l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />,
  network: <path d="M2 12h3l1.5-8 3 12L13 8h1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />,
  page: <path d="M4 2h5l3 3v9H4V2Z M9 2v3h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />,
  user: <path d="M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4.5 5.5a4.5 4.5 0 0 1 9 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />,
  search: <path d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm3.5.5 3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />,
  back: <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />,
  clock: <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Zm0-9v3.5l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />,
  inbox: <path d="M2 9.5 4 3h8l2 6.5V13H2V9.5Zm0 0h3.5l1 1.5h3l1-1.5H14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />,
};

export function Icon({
  name,
  size = 14,
  class: cls,
}: {
  name: IconName;
  size?: number;
  class?: string;
}) {
  return (
    <svg
      class={`icon${cls ? " " + cls : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
