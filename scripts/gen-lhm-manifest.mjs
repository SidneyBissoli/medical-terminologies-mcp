/**
 * Regenera os blocos `tools`, `resources` e `prompts` de lhm.plugin.json
 * (a ficha do LobeHub) a partir da superfície REAL do servidor — o mesmo
 * dump normalizado de scripts/dump-surface.mjs --stdio que alimenta os
 * baselines/ — e sincroniza `version` com package.json.
 *
 * POR QUE EXISTE (2026-09-02): o LobeHub NÃO relê o repositório; a ficha só
 * muda quando `lhm plugin update` publica o manifesto. O manifesto era
 * mantido à mão e ficou parado (versão e tools velhas) enquanto o produto
 * andava. Derivar da fonte, nunca copiar para texto.
 *
 * Rodar após mudança de superfície (exige dist/ fresco):
 *   npm run build && node scripts/gen-lhm-manifest.mjs
 * Depois: npx -y @lobehub/market-cli plugin update --dir .
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const dump = JSON.parse(
  execFileSync(process.execPath, [join(root, "scripts", "dump-surface.mjs"), "--stdio"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifestPath = join(root, "lhm.plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.version = version;
manifest.tools = dump.tools;
manifest.resources = dump.resources;
manifest.prompts = dump.prompts;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `lhm.plugin.json: v${version}, ${dump.tools.length} tools, ` +
    `${dump.resources.length} resources, ${dump.prompts.length} prompts`,
);
