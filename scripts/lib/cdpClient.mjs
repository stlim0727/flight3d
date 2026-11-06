/** Small CDP client shared by multiplayer network and full-simulator acceptance. */
export async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let seq = 0;
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    const request = pending.get(m.id);
    if (request) { pending.delete(m.id); clearTimeout(request.timer); if (m.error) request.reject(new Error(JSON.stringify(m.error))); else request.resolve(m.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send, errors,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    close() { socket.close(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); } pending.clear(); }
  };
}
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await check(); if (last) return last;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}`);
}
