// Test helper: make storage genuinely unavailable.
//
// The obvious approach — patching `Storage.prototype.getItem` — is not portable.
// In some jsdom versions `sessionStorage` is a Proxy that routes through the
// prototype, and in others it does not, so a prototype patch silently reaches
// nothing and the test passes without exercising anything. That is exactly what
// happened here: three "works when storage throws" tests passed locally while
// the code path they claimed to cover threw in CI.
//
// Replacing the global outright works the same way everywhere.

const THROWS = new Proxy(
  {},
  {
    get() {
      return () => {
        throw new Error("storage disabled");
      };
    },
  },
) as Storage;

/**
 * Run `fn` with sessionStorage and localStorage throwing on every access.
 * Restores them afterwards, even if `fn` throws.
 */
export function withStorageDisabled<T>(fn: () => T): T {
  const session = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const local = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "sessionStorage", { value: THROWS, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: THROWS, configurable: true });
  try {
    return fn();
  } finally {
    if (session) Object.defineProperty(globalThis, "sessionStorage", session);
    if (local) Object.defineProperty(globalThis, "localStorage", local);
  }
}
