// One request at a time; a failed request never discards the last good snapshot.
export function startPolling(onSnapshot, onConnection) {
  let timer;
  let running = false;
  let stopped = false;
  let controller;

  async function refresh() {
    if (running || stopped) return;
    clearTimeout(timer);
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch("/api/nodes", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (
        !Array.isArray(data.nodes) ||
        data.nodes.some(
          (node) =>
            typeof node.node_id !== "string" ||
            !["wifi", "bluetooth"].every((radio) =>
              Array.isArray(node.radios?.[radio]?.observations),
            ),
        )
      ) {
        throw new Error("Invalid scanner response");
      }
      onSnapshot(data.nodes);
      onConnection(true);
    } catch {
      if (!stopped) onConnection(false);
    } finally {
      clearTimeout(timeout);
      running = false;
      if (!stopped) timer = setTimeout(refresh, document.hidden ? 10000 : 2000);
    }
  }

  const onVisibility = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener("visibilitychange", onVisibility);
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
