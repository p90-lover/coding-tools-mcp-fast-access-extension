let heartbeatTimer = null;

function start() {
  if (heartbeatTimer) return;
  postMessage({ type: 'heartbeat' });
  heartbeatTimer = setInterval(() => postMessage({ type: 'heartbeat' }), 20_000);
}

function stop() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

onmessage = (event) => {
  if (event.data?.type === 'start') start();
  if (event.data?.type === 'stop') stop();
};
