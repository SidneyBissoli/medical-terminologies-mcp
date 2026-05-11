import pino from 'pino';

const level = (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || 'info';

// Capability-detect, don't runtime-detect: Cloudflare Workers' `nodejs_compat`
// flag fakes `process` and `process.versions.node`, so a check like
// `typeof process.versions.node === 'string'` returns true on Workers too —
// and then `pino.destination(...)` blows up because the destination helper
// is stripped from the Workers-bundled pino (it relies on sonic-boom +
// real fs/fd APIs that the Workers runtime doesn't expose).
//
// What we actually need is "can we write to a Node file descriptor?", which
// is exactly what `pino.destination` provides. If the function is missing,
// we're on Workers (or some other web-standard runtime); hand pino a
// custom write-shim that routes lines to console.log (wrangler tail picks
// these up uniformly).
const hasPinoDestination = typeof (pino as { destination?: unknown }).destination === 'function';

const workersDestination = {
  write(chunk: string): void {
    // pino emits one JSON line per record; trim the trailing newline so
    // wrangler tail / console captures it as a single entry.
    // eslint-disable-next-line no-console
    console.log(chunk.replace(/\n$/, ''));
  },
};

export const logger = hasPinoDestination
  ? pino({ level }, pino.destination({ dest: 2, sync: false }))
  : pino({ level }, workersDestination);

export const createToolLogger = (toolName: string) => {
  return logger.child({ tool: toolName });
};

export const createClientLogger = (clientName: string) => {
  return logger.child({ client: clientName });
};