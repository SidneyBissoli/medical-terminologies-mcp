import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

describe('side-effect import coverage', () => {
  // The side-effect-import pattern (each src/{tools,prompts,resources}/*.ts
  // registers its entries at module load) only works if src/index.ts
  // actually imports every such module. `tree-shaking: false` in the
  // esbuild script protects against the build dropping live code, but
  // does NOT protect against the human failure mode: a developer
  // creates a new module that calls a registry.register(...), forgets
  // to add `import './<dir>/X.js'` to src/index.ts, and the new entry
  // silently fails to appear in tools/list / prompts/list /
  // resources/list with no compile-time error.
  //
  // This test is the cheap defense for that scenario across all three
  // registries. If you add a non-registry module under a covered dir
  // (e.g., a private helper file), explicitly exclude it below.

  const indexContent = readFileSync('src/index.ts', 'utf8');

  function listModules(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isFile() &&
          d.name.endsWith('.ts') &&
          !d.name.endsWith('.test.ts') &&
          !d.name.endsWith('.d.ts'),
      )
      .map((d) => d.name.replace(/\.ts$/, '.js'));
  }

  it('every src/tools/*.ts module is imported by src/index.ts', () => {
    const files = listModules('src/tools');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        indexContent,
        `src/index.ts is missing 'import "./tools/${file}"' — new tool file added without entry-point wiring?`,
      ).toContain(`./tools/${file}`);
    }
  });

  it('every src/prompts/*.ts module is imported by src/index.ts', () => {
    const files = listModules('src/prompts');
    // prompts/ is optional historically — only assert if files exist.
    if (files.length === 0) return;
    for (const file of files) {
      expect(
        indexContent,
        `src/index.ts is missing 'import "./prompts/${file}"' — new prompt file added without entry-point wiring?`,
      ).toContain(`./prompts/${file}`);
    }
  });

  it('every src/resources/*.ts module is imported by src/index.ts', () => {
    const files = listModules('src/resources');
    if (files.length === 0) return;
    for (const file of files) {
      expect(
        indexContent,
        `src/index.ts is missing 'import "./resources/${file}"' — new resource file added without entry-point wiring?`,
      ).toContain(`./resources/${file}`);
    }
  });
});
