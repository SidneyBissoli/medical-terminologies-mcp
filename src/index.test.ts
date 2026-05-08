import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

describe('tool registration coverage', () => {
  // The side-effect-import pattern (each src/tools/*.ts registers its
  // tools at module load) only works if src/index.ts actually imports
  // every tool module. `tree-shaking: false` in the esbuild script
  // protects against the build dropping live code, but does NOT protect
  // against the human failure mode: a developer creates a new
  // src/tools/X.ts that calls toolRegistry.register(...), forgets to
  // add `import './tools/X.js'` to src/index.ts, and the new tool
  // silently fails to appear in tools/list with no compile-time error.
  //
  // This test is the cheap defense for that scenario.
  //
  // If you add a non-tool module under src/tools/ (e.g., a private
  // helper file), explicitly exclude it from `toolFiles` below.

  it('every src/tools/*.ts module is imported by src/index.ts', () => {
    const toolFiles = readdirSync('src/tools', { withFileTypes: true })
      .filter(
        (d) =>
          d.isFile() &&
          d.name.endsWith('.ts') &&
          !d.name.endsWith('.test.ts') &&
          !d.name.endsWith('.d.ts'),
      )
      .map((d) => d.name.replace(/\.ts$/, '.js'));

    // Sanity: the glob should pick up the known tool files. If this
    // drops to 0, the test isn't actually checking anything.
    expect(toolFiles.length).toBeGreaterThan(0);

    const indexContent = readFileSync('src/index.ts', 'utf8');

    for (const file of toolFiles) {
      expect(
        indexContent,
        `src/index.ts is missing 'import "./tools/${file}"' — new tool file added without entry-point wiring?`,
      ).toContain(`./tools/${file}`);
    }
  });
});
