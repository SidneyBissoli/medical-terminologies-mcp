/**
 * Guard: no production code builds an error result by hand.
 *
 * Measured in production on 2026-09-30: a handler returned
 * `{ content, isError: true }` with no telemetry class, the hook fell back to
 * the phrase, and the echoed code "INVALID" matched `invalid` -> `contrato`.
 * Every error result must leave through a helper that DECLARES its class
 * (`naoEncontrado`, `falhaDaFonte`, `handleToolError`, `comClasse` in
 * src/utils/zod-schema.ts), so the compiler — not the phrase — carries it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Files allowed to write the literal, and why. */
const PERMITIDOS: Record<string, string> = {
  // The helpers themselves: each one attaches the class (`comClasse`).
  'utils/zod-schema.ts': 'home of the error helpers',
  // The dispatcher's last-resort catch: the literal is wrapped in
  // `comClasse(…, forma.classe)` with the class it just recorded.
  'register.ts': 'dispatcher catch, wrapped in comClasse',
};

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return nome === '__fixtures__' ? [] : arquivos(p);
    return /\.ts$/.test(nome) && !/\.test\.ts$/.test(nome) ? [p] : [];
  });
}

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no hand-built error result in production code', () => {
  it('`isError: true` appears only in the allowed helper files', () => {
    const infratores = arquivos(SRC)
      .map((p) => relative(SRC, p).split(sep).join('/'))
      .filter((rel) => !(rel in PERMITIDOS))
      .filter((rel) => /\bisError\s*:\s*true\b/.test(semComentarios(readFileSync(join(SRC, rel), 'utf8'))));
    expect(infratores).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    for (const rel of Object.keys(PERMITIDOS)) {
      expect(readFileSync(join(SRC, rel), 'utf8')).toMatch(/\bisError\s*:\s*true\b/);
    }
  });
});
