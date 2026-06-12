/** POST JSON to url. Returns false on network error (caller re-queues the batch). */
export async function postJSON(url: string, body: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}
