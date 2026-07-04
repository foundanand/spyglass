import { Replayer, ReplayerEvents } from "rrweb";

/**
 * A self-contained rrweb replay surface: mounts an rrweb `Replayer` directly
 * and renders a custom timeline (play/pause, a scrub track that VISUALISES idle
 * periods, event markers, playback speed, and a skip-idle toggle).
 *
 * We drive rrweb's `Replayer` ourselves instead of using `rrweb-player` because
 * the latter is a Svelte component whose `onMount` (where it builds the inner
 * Replayer) does not run when instantiated inside this Preact + esbuild bundle.
 * The low-level `Replayer` API has no such lifecycle dependency and is exactly
 * what rrweb-player wraps, so we lose nothing but the packaged UI.
 */
export interface Marker {
  /** Offset in ms from the first event. */
  offset: number;
  kind: "error" | "bug" | "pageview" | "incident";
  label: string;
}

export interface ReplayHandle {
  /** Tear down the replayer, listeners, and DOM. */
  destroy(): void;
  /** Seek to an absolute offset (ms from the first event); optionally play. */
  goto(ms: number, play?: boolean): void;
  /** Place event markers on the timeline (offsets are ms from the first event). */
  setMarkers(markers: Marker[]): void;
  /** Subscribe to playback position; called ~10×/s with the current offset (ms). */
  onTimeUpdate(cb: (offsetMs: number) => void): void;
}

// rrweb IncrementalSnapshot sources that count as *user* activity. A gap with no
// such event is "idle" — this mirrors rrweb's own skip-inactive heuristic, so the
// hatched regions we draw line up with where playback fast-forwards.
const INTERACTIVE_SOURCES = new Set([1, 2, 3, 5, 6]); // Move, Interaction, Scroll, Input, Touch
const IDLE_THRESHOLD = 10_000; // rrweb SKIP_TIME_THRESHOLD

const SPEEDS = [1, 2, 4, 8];

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const ICON: Record<string, string> = {
  play: '<path d="M5 3.5v9l7-4.5-7-4.5Z"/>',
  pause: '<path d="M5 3.5h2v9H5v-9Zm4 0h2v9H9v-9Z"/>',
  skip: '<path d="M4 3.5v9l5-4.5-5-4.5Zm5 0v9l5-4.5-5-4.5Z"/>',
};
const icon = (name: keyof typeof ICON): string =>
  `<svg class="icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`;

interface IdleSpan {
  start: number; // ms offset from startTime
  end: number;
}

/** Idle spans (ms offsets) computed from the merged rrweb event stream. */
function computeIdle(events: unknown[], startTime: number, total: number): IdleSpan[] {
  const acts: number[] = [];
  for (const ev of events) {
    const e = ev as { type?: number; timestamp?: number; data?: { source?: number } };
    if (typeof e.timestamp !== "number") continue;
    if (e.type === 2) acts.push(e.timestamp); // FullSnapshot
    else if (e.type === 3 && e.data && INTERACTIVE_SOURCES.has(e.data.source ?? -1)) {
      acts.push(e.timestamp);
    }
  }
  acts.sort((a, b) => a - b);
  const spans: IdleSpan[] = [];
  for (let i = 0; i < acts.length - 1; i++) {
    const gap = acts[i + 1] - acts[i];
    if (gap > IDLE_THRESHOLD) {
      spans.push({ start: acts[i] - startTime, end: acts[i + 1] - startTime });
    }
  }
  // Trailing idle: last activity to the end of the recording.
  if (acts.length > 0) {
    const lastOff = acts[acts.length - 1] - startTime;
    if (total - lastOff > IDLE_THRESHOLD) spans.push({ start: lastOff, end: total });
  }
  return spans;
}

export function createReplaySurface(root: HTMLElement, events: unknown[]): ReplayHandle {
  root.innerHTML = "";
  root.classList.add("rr-surface");

  const stage = document.createElement("div");
  stage.className = "rr-stage";
  const skipChip = document.createElement("div");
  skipChip.className = "rr-skip-chip";
  skipChip.innerHTML = `${icon("skip")}<span class="rr-skip-label">skipping idle</span>`;
  stage.appendChild(skipChip);

  const controls = document.createElement("div");
  controls.className = "rr-controls";
  root.append(stage, controls);

  // Fast-forward through idle gaps by default — most recordings of an internal
  // tool are mostly idle. Persisted per-browser.
  let skipInactive = localStorage.getItem("sg.skipIdle") !== "0";
  let userSpeed = Number(localStorage.getItem("sg.speed")) || 1;
  if (!SPEEDS.includes(userSpeed)) userSpeed = 1;

  const replayer = new Replayer(events as never, {
    root: stage,
    skipInactive,
    speed: userSpeed,
    showWarning: false,
    mouseTail: false,
  });

  const meta = replayer.getMetaData();
  const total = meta.totalTime;
  const startTime = meta.startTime;
  const idleSpans = computeIdle(events, startTime, total);
  const idleTotal = idleSpans.reduce((sum, s) => sum + (s.end - s.start), 0);
  const activeTotal = Math.max(0, total - idleTotal);

  // ---- control bar DOM ----
  const playBtn = document.createElement("button");
  playBtn.className = "rr-btn";
  playBtn.type = "button";
  playBtn.innerHTML = icon("play");

  const timeline = document.createElement("div");
  timeline.className = "rr-timeline";
  const track = document.createElement("div");
  track.className = "rr-track";
  const activeFill = document.createElement("div");
  activeFill.className = "rr-active-fill";
  const playhead = document.createElement("div");
  playhead.className = "rr-playhead";
  track.append(activeFill);

  // Idle segments (drawn once).
  const pct = (ms: number) => (total > 0 ? Math.max(0, Math.min(100, (ms / total) * 100)) : 0);
  for (const s of idleSpans) {
    const seg = document.createElement("div");
    seg.className = "rr-idle";
    seg.style.left = `${pct(s.start)}%`;
    seg.style.width = `${pct(s.end) - pct(s.start)}%`;
    seg.title = `idle ${fmt(s.end - s.start)}`;
    track.append(seg);
  }
  const markerLayer = document.createElement("div");
  markerLayer.style.cssText = "position:absolute;inset:0;pointer-events:none";
  track.append(markerLayer, playhead);
  const scrubTip = document.createElement("div");
  scrubTip.className = "rr-scrub-tip";
  timeline.append(track, scrubTip);

  const time = document.createElement("span");
  time.className = "rr-time";

  const speedBtn = document.createElement("button");
  speedBtn.className = "rr-speed";
  speedBtn.type = "button";

  const skipBtn = document.createElement("button");
  skipBtn.className = "rr-toggle";
  skipBtn.type = "button";
  skipBtn.title = "Fast-forward through periods with no activity";
  skipBtn.innerHTML = `${icon("skip")}<span>skip idle</span>`;

  controls.append(playBtn, timeline, time, speedBtn, skipBtn);

  // ---- progress tracking ----
  // Track progress by wall-clock elapsed since play started, not
  // replayer.getCurrentTime() — the latter only advances at event boundaries,
  // so it appears frozen through the idle gaps of a sparse recording. During
  // skip-inactive fast-forward the replayer runs at `speed`×, so elapsed wall
  // time is scaled and rebased on every speed change (SkipStart/SkipEnd).
  let playing = false;
  let raf = 0;
  let baseOffset = 0; // replay offset (ms) at the last play/seek/speed change
  let baseWall = 0; // performance.now() captured at that moment
  let speed = userSpeed; // current effective wall-clock multiplier
  let skipping = false; // rrweb currently fast-forwarding an idle gap
  let timeCb: ((ms: number) => void) | null = null;

  const currentOffset = (): number =>
    Math.min(baseOffset + (performance.now() - baseWall) * speed, total);
  const rebase = (offset: number): void => {
    baseOffset = offset;
    baseWall = performance.now();
  };

  const render = (cur: number): void => {
    const p = pct(cur);
    activeFill.style.width = `${p}%`;
    playhead.style.left = `${p}%`;
    time.innerHTML =
      `${fmt(cur)} / ${fmt(total)} <span class="active-t">· ${fmt(activeTotal)} active</span>`;
    if (timeCb) timeCb(cur);
  };

  const stopLoop = (): void => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const setPlaying = (p: boolean): void => {
    playing = p;
    playBtn.innerHTML = icon(p ? "pause" : "play");
    stopLoop();
    if (p) {
      const loop = () => {
        const cur = currentOffset();
        render(cur);
        if (cur >= total) {
          setPlaying(false);
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
  };

  const play = (offset?: number): void => {
    skipping = false;
    speed = userSpeed;
    rebase(offset ?? baseOffset);
    replayer.play(baseOffset);
    setPlaying(true);
  };
  const pause = (): void => {
    rebase(currentOffset());
    skipping = false;
    speed = userSpeed;
    replayer.pause();
    setPlaying(false);
  };

  const seekTo = (offset: number): void => {
    const t = Math.max(0, Math.min(offset, total));
    if (playing) {
      play(t);
    } else {
      replayer.pause(t);
      rebase(t);
      render(t);
    }
  };

  // ---- track scrubbing (click + drag) ----
  const offsetFromClientX = (clientX: number): number => {
    const r = track.getBoundingClientRect();
    const frac = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return Math.max(0, Math.min(1, frac)) * total;
  };
  // Time tooltip that follows the cursor across the track (hover + scrub).
  const isIdleAt = (ms: number): boolean => idleSpans.some((s) => ms >= s.start && ms <= s.end);
  const showTip = (clientX: number): void => {
    const r = track.getBoundingClientRect();
    const frac = r.width > 0 ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
    const ms = frac * total;
    scrubTip.textContent = isIdleAt(ms) ? `${fmt(ms)} · idle` : fmt(ms);
    scrubTip.classList.toggle("idle", isIdleAt(ms));
    scrubTip.style.left = `${frac * 100}%`;
    scrubTip.classList.add("show");
  };
  let scrubbing = false;
  track.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    track.setPointerCapture(e.pointerId);
    showTip(e.clientX);
    seekTo(offsetFromClientX(e.clientX));
  });
  track.addEventListener("pointermove", (e) => {
    showTip(e.clientX);
    if (scrubbing) seekTo(offsetFromClientX(e.clientX));
  });
  track.addEventListener("pointerleave", () => {
    if (!scrubbing) scrubTip.classList.remove("show");
  });
  track.addEventListener("pointerup", (e) => {
    scrubbing = false;
    scrubTip.classList.remove("show");
    try { track.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  });

  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  replayer.on(ReplayerEvents.Finish, () => setPlaying(false));

  // Keep the scrubber honest through fast-forwarded idle gaps: rrweb announces
  // each speed burst via SkipStart {speed} and returns to config speed on SkipEnd.
  replayer.on(ReplayerEvents.SkipStart, (payload) => {
    rebase(replayer.getCurrentTime());
    skipping = true;
    speed = (payload as { speed?: number })?.speed ?? speed;
    skipChip.classList.add("show");
    const lbl = skipChip.querySelector(".rr-skip-label");
    if (lbl) lbl.textContent = `skipping idle · ${Math.round(speed)}×`;
  });
  replayer.on(ReplayerEvents.SkipEnd, () => {
    rebase(replayer.getCurrentTime());
    skipping = false;
    speed = userSpeed;
    skipChip.classList.remove("show");
  });

  // ---- speed ----
  const renderSpeed = (): void => {
    speedBtn.textContent = `${userSpeed}×`;
  };
  speedBtn.addEventListener("click", () => {
    userSpeed = SPEEDS[(SPEEDS.indexOf(userSpeed) + 1) % SPEEDS.length];
    localStorage.setItem("sg.speed", String(userSpeed));
    replayer.setConfig({ speed: userSpeed });
    if (!skipping) {
      rebase(currentOffset());
      speed = userSpeed;
    }
    renderSpeed();
  });
  renderSpeed();

  // ---- skip toggle ----
  const renderSkipBtn = (): void => {
    skipBtn.classList.toggle("active", skipInactive);
  };
  skipBtn.addEventListener("click", () => {
    skipInactive = !skipInactive;
    localStorage.setItem("sg.skipIdle", skipInactive ? "1" : "0");
    replayer.setConfig({ skipInactive });
    renderSkipBtn();
  });
  renderSkipBtn();

  // ---- markers ----
  const setMarkers = (markers: Marker[]): void => {
    markerLayer.innerHTML = "";
    for (const m of markers) {
      const el = document.createElement("div");
      el.className = `rr-marker m-${m.kind}`;
      el.style.left = `${pct(m.offset)}%`;
      el.style.pointerEvents = "auto";
      el.title = m.label;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        seekTo(m.offset);
      });
      markerLayer.append(el);
    }
  };

  // ---- keyboard (when the surface is focused / hovered) ----
  const onKey = (e: KeyboardEvent): void => {
    if (!root.matches(":hover")) return;
    if (e.key === " ") {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.key === "ArrowLeft") {
      seekTo(currentOffset() - 5000);
    } else if (e.key === "ArrowRight") {
      seekTo(currentOffset() + 5000);
    }
  };
  window.addEventListener("keydown", onKey);

  // Scale the recorded viewport down to fit the available width.
  const scaleToFit = (): void => {
    const wrapper = stage.querySelector<HTMLElement>(".replayer-wrapper");
    const iframe = stage.querySelector("iframe");
    if (!wrapper || !iframe) return;
    const recW = iframe.offsetWidth || Number(iframe.getAttribute("width")) || 0;
    const recH = iframe.offsetHeight || Number(iframe.getAttribute("height")) || 0;
    if (!recW) return;
    const availW = root.clientWidth || stage.clientWidth || recW;
    const scale = Math.min(1, availW / recW);
    wrapper.style.transformOrigin = "top left";
    wrapper.style.transform = `scale(${scale})`;
    stage.style.height = `${Math.round(recH * scale)}px`;
  };
  replayer.on(ReplayerEvents.Resize, () => scaleToFit());
  const onWinResize = (): void => scaleToFit();
  window.addEventListener("resize", onWinResize);
  // Re-fit whenever the surrounding column changes width (sidebar collapse,
  // inspector stacking, window resize) — smoother than listening to resize alone.
  const ro = new ResizeObserver(() => scaleToFit());
  ro.observe(root);
  // Poll a few frames until rrweb's iframe reports its recorded dimensions,
  // rather than guessing with a fixed 50ms timeout that raced iframe layout
  // (and caused the visible height snap on load).
  let fitTries = 0;
  const tryFit = (): void => {
    const iframe = stage.querySelector("iframe");
    const ready = iframe && (iframe.offsetWidth || Number(iframe.getAttribute("width")));
    scaleToFit();
    if (!ready && fitTries++ < 40) requestAnimationFrame(tryFit);
  };
  requestAnimationFrame(tryFit);

  render(0);
  setPlaying(false);

  return {
    destroy() {
      stopLoop();
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      window.removeEventListener("keydown", onKey);
      try {
        replayer.pause();
        (replayer as unknown as { destroy?: () => void }).destroy?.();
      } catch {
        /* noop */
      }
      root.innerHTML = "";
      root.classList.remove("rr-surface");
    },
    goto(ms: number, playAfter = false) {
      const t = Math.max(0, Math.min(ms, total));
      if (playAfter) {
        play(t);
      } else {
        skipping = false;
        speed = userSpeed;
        rebase(t);
        replayer.pause(t);
        setPlaying(false);
        render(t);
      }
    },
    setMarkers,
    onTimeUpdate(cb) {
      timeCb = cb;
    },
  };
}
