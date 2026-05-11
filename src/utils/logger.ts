import pino from 'pino';

const level = (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || 'info';

// Runtime detection: in Node we write pino to fd 2 (stderr) to keep stdout
// free for the MCP stdio transport. In Cloudflare Workers there's no fd —
// pino.destination would throw at import — so we hand it a write-shim that
// pipes lines to console.log (wrangler tail picks it up uniformly).
const isNode =
  typeof process !== 'undefined' &&
  typeof process.versions?.node === 'string' &&
  typeof process.stderr?.write === 'function';

const workersDestination = {
  write(chunk: string): void {
    // pino emits one JSON line per record; trim the trailing newline so
    // wrangler tail / console captures it as a single entry.
    // eslint-disable-next-line no-console
    console.log(chunk.replace(/\n$/, ''));
  },
};

export const logger = isNode
  ? pino({ level }, pino.destination({ dest: 2, sync: false }))
  : pino({ level }, workersDestination);

export const createToolLogger = (toolName: string) => {
  return logger.child({ tool: toolName });
};

export const createClientLogger = (clientName: string) => {
  return logger.child({ client: clientName });
};