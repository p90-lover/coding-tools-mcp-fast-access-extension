(() => {
  const worker = new Worker(chrome.runtime.getURL('offscreen-heartbeat-worker.js'));

  worker.onmessage = async (event) => {
    if (event.data?.type !== 'heartbeat') return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_HEARTBEAT',
        at: Date.now(),
      });
      if (response?.active === false) worker.postMessage({ type: 'stop' });
    } catch {
      // Retry on the next worker heartbeat if the service worker is restarting.
    }
  };

  worker.postMessage({ type: 'start' });
})();
