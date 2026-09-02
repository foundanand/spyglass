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
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // Space would scroll the page
        onActivate();
      }
    },
  };
}
