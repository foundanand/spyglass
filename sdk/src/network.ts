import { enqueue } from "./queue.js";
import { getConfig, isInitialized } from "./core.js";
import { currentSessionId } from "./session.js";
import type { EventRecord, NetworkConfig } from "./types.js";

const BODY_MAX_BYTES = 2048;
const BLOCKED_HEADERS = new Set(["authorization", "cookie", "set-cookie"]);

// Store patched originals so stopNetworkTracking can restore them.
let origFetch: typeof window.fetch | null = null;
let origXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let origXHRSend: typeof XMLHttpRequest.prototype.send | null = null;
let installed = false;

// Endpoint captured at install time to avoid reading config on every request.
let ownEndpoint = "";

interface XHRState {
  method: string;
  url: string;
  startTs: number;
}

const xhrMeta = new WeakMap<XMLHttpRequest, XHRState>();

function base(): Omit<EventRecord, "type" | "name"> {
  const cfg = getConfig();
  return {
    ts: Date.now(),
    app: cfg.app,
    user_id: cfg.user.id,
    session_id: currentSessionId(),
    url: typeof location !== "undefined" ? location.href : undefined,
  };
}

function isOwn(url: string): boolean {
  return ownEndpoint !== "" && url.startsWith(ownEndpoint);
}

function bodyAllowed(url: string): boolean {
  if (!isInitialized()) return false;
  const cfg = getConfig();
  // network:false, network:true, or network:undefined (not set) → no body capture
  if (!cfg.network || cfg.network === true) return false;
  const prefixes = (cfg.network as NetworkConfig).bodies ?? [];
  return prefixes.some((p) => url.includes(p));
}

function truncate(s: string): string {
  return s.length <= BODY_MAX_BYTES ? s : s.slice(0, BODY_MAX_BYTES) + "…";
}

function bodySize(b: BodyInit | Document | null | undefined): number {
  if (!b) return 0;
  if (typeof b === "string") return new TextEncoder().encode(b).byteLength;
  if (b instanceof Blob) return b.size;
  if (b instanceof ArrayBuffer) return b.byteLength;
  if (ArrayBuffer.isView(b)) return b.byteLength;
  return 0;
}

function sanitizedHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  const headers = h instanceof Headers ? h : new Headers(h as Record<string, string>);
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    if (!BLOCKED_HEADERS.has(k.toLowerCase())) out[k] = v;
  });
  return out;
}

export function startNetworkTracking(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!isInitialized()) return;

  const cfg = getConfig();
  if (!cfg.network) return; // false or undefined → skip

  ownEndpoint = cfg.endpoint;
  installed = true;

  // --- fetch patch ---
  origFetch = window.fetch.bind(window);
  const _origFetch = origFetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (isOwn(url)) return _origFetch(input, init);

    const method = (
      init?.method ??
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const startTs = Date.now();
    const reqSize = bodySize(init?.body as BodyInit | null);

    let response: Response;
    try {
      response = await _origFetch(input, init);
    } catch (err) {
      if (isInitialized()) {
        enqueue({
          ...base(),
          type: "network",
          name: url,
          props: { method, status: 0, duration_ms: Date.now() - startTs, req_size: reqSize, res_size: 0 },
        });
      }
      throw err;
    }

    const duration_ms = Date.now() - startTs;
    const cl = response.headers.get("content-length");
    let resSize = cl ? parseInt(cl, 10) : 0;

    const props: Record<string, unknown> = {
      method,
      status: response.status,
      duration_ms,
      req_size: reqSize,
      res_size: resSize,
    };

    if (bodyAllowed(url)) {
      try {
        const text = await response.clone().text();
        resSize = resSize || new TextEncoder().encode(text).byteLength;
        props.res_size = resSize;
        props.body_excerpt = truncate(text);
      } catch {
        // ignore — body capture is best-effort
      }
    }

    if (isInitialized()) {
      enqueue({ ...base(), type: "network", name: url, props });
    }

    return response;
  };

  // --- XHR patch ---
  if (typeof XMLHttpRequest !== "undefined") {
    origXHROpen = XMLHttpRequest.prototype.open;
    origXHRSend = XMLHttpRequest.prototype.send;

    const _origOpen = origXHROpen;
    const _origSend = origXHRSend;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XMLHttpRequest.prototype as any).open = function (
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      xhrMeta.set(this, {
        method: method.toUpperCase(),
        url: typeof url === "string" ? url : url.href,
        startTs: 0,
      });
      return (_origOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XMLHttpRequest.prototype as any).send = function (
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const state = xhrMeta.get(this);
      if (!state || isOwn(state.url)) {
        return (_origSend as (...a: unknown[]) => void).apply(this, [body]);
      }

      state.startTs = Date.now();
      const reqSize = bodySize(body as BodyInit | null);
      const xhr = this;

      const onDone = () => {
        if (!isInitialized()) return;
        const duration_ms = Date.now() - state.startTs;
        const status = xhr.status ?? 0;
        const cl = xhr.getResponseHeader?.("content-length");
        let resSize = cl ? parseInt(cl, 10) : 0;

        const props: Record<string, unknown> = {
          method: state.method,
          status,
          duration_ms,
          req_size: reqSize,
          res_size: resSize,
        };

        if (bodyAllowed(state.url)) {
          try {
            const text =
              typeof xhr.responseText === "string" ? xhr.responseText : "";
            resSize = resSize || new TextEncoder().encode(text).byteLength;
            props.res_size = resSize;
            props.body_excerpt = truncate(text);
          } catch {
            // ignore
          }
        }

        enqueue({ ...base(), type: "network", name: state.url, props });
      };

      xhr.addEventListener("load", onDone);
      xhr.addEventListener("error", onDone);
      xhr.addEventListener("abort", onDone);

      return (_origSend as (...a: unknown[]) => void).apply(this, [body]);
    };
  }
}

export function stopNetworkTracking(): void {
  if (!installed) return;
  if (origFetch) {
    window.fetch = origFetch;
    origFetch = null;
  }
  if (origXHROpen && typeof XMLHttpRequest !== "undefined") {
    XMLHttpRequest.prototype.open = origXHROpen;
    origXHROpen = null;
  }
  if (origXHRSend && typeof XMLHttpRequest !== "undefined") {
    XMLHttpRequest.prototype.send = origXHRSend;
    origXHRSend = null;
  }
  ownEndpoint = "";
  installed = false;
}

/** Reset network tracking state — for testing only. */
export function _resetNetwork(): void {
  stopNetworkTracking();
}

/** Returns whether fetch is currently patched — for testing only. */
export function _isInstalled(): boolean {
  return installed;
}

/** Exposed for tests to verify header filtering. */
export { sanitizedHeaders };
