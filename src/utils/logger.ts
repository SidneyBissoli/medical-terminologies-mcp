import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

// Always write to stderr to not break MCP stdio protocol
export const logger = pino(
  { level },
  pino.destination({ dest: 2, sync: false })
);

export const createToolLogger = (toolName: string) => {
  return logger.child({ tool: toolName });
};

export const createClientLogger = (clientName: string) => {
  return logger.child({ client: clientName });
};