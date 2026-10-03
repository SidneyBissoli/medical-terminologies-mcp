/**
 * The server icon: bytes x manifest x handshake (PROGRESS.md 16.1).
 *
 * This server does not serve its icon itself (no `/icon.png` route, unlike the
 * siblings): every declaration points at
 * `raw.githubusercontent.com/.../main/assets/icon-{dark,light}.png`, so the
 * FILES in `assets/` are what clients and directories fetch. Three places
 * declare them and must never disagree:
 *
 *   1. `assets/icon-{dark,light}.png` — the bytes;
 *   2. `server.json`                  — what the MCP Registry and every
 *                                       directory mirror;
 *   3. `SERVER_ICONS` (src/server-core.ts) — the stdio handshake's serverInfo.
 *
 * The Worker's copy (`worker/src/config.ts`) is pinned to `server.json` by
 * `worker/tests/serverinfo-sync.test.ts`, which compares title, websiteUrl and
 * icons for the Worker but only title and websiteUrl for stdio — the stdio
 * icons were the unguarded side. Rename or resize a PNG, or edit one list and
 * not the other, and every side still answers 200: no error anywhere, a
 * broken or mismatched image in every listing. The five sibling servers have
 * this gate; this file closes the gap.
 *
 * It pins `mimeType` and `sizes` to what the image REALLY is — a manifest
 * advertising 512x512 for something else is the same lie the output-contract
 * test catches in tool responses.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SERVER_ICONS, type ServerIcon } from './server-core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_BASE = 'https://raw.githubusercontent.com/SidneyBissoli/medical-terminologies-mcp/main/';

const manifestIcons = (): ServerIcon[] =>
  (JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8')) as { icons?: ServerIcon[] }).icons ?? [];

/** Repository path the raw URL resolves to (`assets/icon-dark.png`). */
function localPath(src: string): string {
  expect(src.startsWith(RAW_BASE), `${src} is not served from this repository's main branch`).toBe(true);
  return src.slice(RAW_BASE.length);
}

/** Dimensions from the PNG IHDR header — no image dependency. */
function pngSize(buf: Buffer): string {
  expect(buf.subarray(0, 8).toString('hex'), 'not a PNG').toBe('89504e470d0a1a0a');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('server icon: bytes x manifest x handshake', () => {
  it('server.json declares a dark and a light icon', () => {
    const themes = manifestIcons().map((i) => i.theme).sort();
    expect(themes, 'server.json must declare icons — 5 completeness points in the directories').toEqual([
      'dark',
      'light',
    ]);
  });

  it('every declared icon is a file in this repository, at the path its URL serves', () => {
    for (const icon of manifestIcons()) {
      const path = localPath(icon.src);
      expect(existsSync(join(ROOT, path)), `${path} is declared but missing — the URL would 404`).toBe(true);
    }
  });

  it('mimeType and sizes describe the image that exists, not a promise', () => {
    for (const icon of manifestIcons()) {
      const bytes = readFileSync(join(ROOT, localPath(icon.src)));
      expect(icon.mimeType).toBe('image/png');
      expect(icon.sizes).toEqual([pngSize(bytes)]);
    }
  });

  it("every icon fits under Smithery's 1 MB ceiling", () => {
    for (const icon of manifestIcons()) {
      expect(readFileSync(join(ROOT, localPath(icon.src))).byteLength).toBeLessThan(1024 * 1024);
    }
  });

  it('the stdio handshake announces exactly the icons of server.json', () => {
    const key = (i: ServerIcon) => JSON.stringify([i.src, i.mimeType, i.sizes, i.theme]);
    expect(SERVER_ICONS.map(key).sort()).toEqual(manifestIcons().map(key).sort());
  });
});
