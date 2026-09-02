/**
 * POST JSON to url.
 *
 * @returns false when the caller should re-queue the batch and try again.
 *
 * Retry only what retrying can fix. A network error or a 5xx/429 is the
 * collector being down, restarting or throttling — the batch is good and will
 * land on the next flush. A 4xx is the batch itself being unacceptable (wrong
 * app key, malformed body, over the size limit); re-queueing that resends the
 * same rejected payload forever and, because a failed batch goes back to the
 * front of the queue, blocks every event behind it.
 */
export async function postJSON(url: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    if (res.status === 429 || res.status >= 500) return false;
    return true;
  } catch {
    return false;
  }
}
