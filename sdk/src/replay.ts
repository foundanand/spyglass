// Lazy-loaded only when replay:true — never imported eagerly from index.ts.
// rrweb and the console plugin are themselves dynamic imports inside here,
// so they become separate esbuild chunks that are only fetched at runtime.

import type { eventWithTime } from "rrweb";
import { getConfig } from "./core.js";
import { currentSessionId } from "./session.js";

let seq = 0;
let pendingUploads = 0;
let stopFn: (() => void) | null = null;
const MAX_PENDING = 3;

export async function startReplay(): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !cfg.replay) return;
  if (stopFn) return; // idempotent

  const { record } = await import("rrweb");

  // Console plugin is a separate package — gracefully skip if absent.
  let consolePlugin: unknown | null = null;
  try {
    const m = await import("@rrweb/rrweb-plugin-console-record" as string);
    const fn = (m as Record<string, unknown>).getRecordConsolePlugin;
    if (typeof fn === "function") consolePlugin = fn();
  } catch {
    // plugin not installed or unavailable — recording continues without console capture
  }

  let buffer: eventWithTime[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const chunk = buffer.splice(0);
      if (chunk.length > 0) void upload(chunk);
    }, 10_000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = consolePlugin ? [consolePlugin] : [];

  stopFn = record({
    emit(event) {
      buffer.push(event as eventWithTime);
      scheduleFlush();
    },
    plugins,
  }) ?? null;
}

export function stopReplay(): void {
  stopFn?.();
  stopFn = null;
}

/** Force-flush whatever's buffered (called on tab close via beacon). */
export async function flushReplay(): Promise<void> {
  // There's no synchronous flush path for replay chunks; we just let the
  // in-flight timer complete. sendBeacon cannot carry gzipped blobs reliably
  // on all browsers, so we accept possible loss of the last partial chunk.
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function upload(events: eventWithTime[]): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  if (pendingUploads >= MAX_PENDING) {
    // Backpressure: drop replay, never drop analytics events.
    return;
  }

  const sessionId = currentSessionId();
  const chunkSeq = ++seq;
  const firstTs = events[0]?.timestamp ?? 0;

  let body: Uint8Array;
  try {
    body = await gzip(JSON.stringify(events));
  } catch {
    return; // CompressionStream unavailable (old browser) — skip silently
  }

  pendingUploads++;
  try {
    await fetch(
      `${cfg.endpoint}/v1/replay?session=${encodeURIComponent(sessionId)}&seq=${chunkSeq}&ts=${firstTs}&app=${encodeURIComponent(cfg.app)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "gzip",
          "x-spyglass-key": cfg.key,
        },
        body: body.buffer as ArrayBuffer,
      },
    );
  } catch {
    // Network errors are silent — replay is best-effort
  } finally {
    pendingUploads--;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gzip(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(text));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
