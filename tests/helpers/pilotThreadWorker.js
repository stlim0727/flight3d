import { Worker } from 'node:worker_threads';

/** Node transport for the production pilot runtime; no browser or renderer. */
export class PilotThreadWorker {
  constructor() {
    this.thread = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { createPilotRuntime } = await import(workerData.runtimeUrl);
        const receive = createPilotRuntime({
          send: message => parentPort.postMessage(message),
          loadModule: source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
        });
        parentPort.on('message', message => { void receive(message); });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: {
      runtimeUrl: new URL('../../src/pilot/pilot.worker.js', import.meta.url).href,
    } });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.(error));
  }
  postMessage(message) { this.thread.postMessage(message); }
  terminate() { return this.thread.terminate(); }
}
