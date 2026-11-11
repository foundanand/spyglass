// Table rows that act as buttons.
//
// A <tr> cannot be a <button>, but a row that navigates must still be reachable
// without a mouse: the drill-down paths are the product's main structure, and
// paths only keyboard users cannot walk are paths that do not exist for them.
//
// This gives a row the button contract — focusable, activated by Enter and
// Space, announced as a control — without restructuring every table.

/** Spread onto a <tr> that behaves as a control. */
export function rowButton(onActivate: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: (e: MouseEvent) => {
      onActivate();
      // tabIndex makes a mouse click focus the row. Left there, the next Space
      // would activate the row again (re-opening a session, or re-seeking and
      // undoing a pause) instead of reaching the player's own shortcut. A real
      // pointer click has detail > 0; keyboard activation takes the path below.
      if (e.detail > 0) (e.currentTarget as HTMLElement | null)?.blur();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // Space would scroll the page
        // Handled here, so it must not also reach the window-level player
        // shortcuts and toggle playback a second time.
        e.stopPropagation();
        onActivate();
      }
    },
  };
}
