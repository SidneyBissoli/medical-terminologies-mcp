/**
 * Logging JSON estruturado — capturado por Workers Logs / wrangler tail.
 *
 * Todos os níveis escrevem em stderr (`console.error`). No Worker isso é
 * indistinguível de stdout para captura de log, mas se este servidor ganhar um
 * canal npm/stdio (padrão do portfólio: mesmo `buildServer` sobre
 * StdioServerTransport), stdout é o stream JSON-RPC do protocolo — qualquer byte
 * perdido ali corrompe o transporte. Manter tudo em stderr torna o mesmo logger
 * seguro nos dois runtimes; o campo `level` preserva a distinção para filtragem.
 */

type LogFields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", msg: string, fields?: LogFields): void {
  const entry = { level, msg, ts: new Date().toISOString(), ...fields };
  console.error(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
