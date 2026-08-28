// A versão vive em UM lugar — package.json — e é espelhada nos arquivos que não
// conseguem derivá-la sozinhos:
//   server.json     manifesto do MCP Registry (topo e cada packages[].version)
//   src/version.ts  constante VERSION do runtime, quando existe
//   src/config.ts   SERVER_CONFIG.version, quando existe
// package-lock.json é responsabilidade do próprio npm.
//
// Roda pelo hook `version` do npm, então um único `npm version <patch|minor|x.y.z>`
// atualiza todos de uma vez. Também roda solto, depois de editar o package.json
// à mão: `node scripts/sync-version.mjs`.
//
// POR QUE ISTO EXISTE (2026-08-27): o portfólio tinha DUAS convenções. Em três
// repositórios o server.json era reescrito em CI na hora de publicar, e por isso
// o arquivo commitado mentia sobre a versão — ibge dizia 3.0.2 com o pacote em
// 3.3.0. Nos outros ele era commitado em sincronia. As duas funcionavam
// isoladas, mas ninguém que lesse o arquivo sabia qual estava lendo. Convergimos
// na commitada: o arquivo no repositório é o que gente e rastreador leem.
//
// A substituição é por regex dirigida, não re-serialização, para o diff mostrar
// só o bump e a formatação ficar byte-estável.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`package.json version looks invalid: ${JSON.stringify(version)}`);
}

const targets = [
  { file: "server.json", re: /("version":\s*")\d+\.\d+\.\d+[^"]*(")/g },
  { file: "src/version.ts", re: /(export const VERSION = ")\d+\.\d+\.\d+[^"]*(")/ },
  { file: "src/config.ts", re: /(\bversion:\s*")\d+\.\d+\.\d+[^"]*(")/ },
];

let mirrored = 0;
let changed = 0;
for (const { file, re } of targets) {
  const path = join(root, file);
  if (!existsSync(path)) continue; // alvo opcional: nem todo servidor tem os três
  const before = readFileSync(path, "utf8");
  // Distinguir "não achei o que sincronizar" de "já estava certo" — as duas
  // coisas produzem o mesmo texto de saída se a gente só comparar antes/depois,
  // e aí um arquivo que não espelha nada passa por sincronizado.
  re.lastIndex = 0;
  if (!re.test(before)) {
    console.log(`${file}: sem campo de versão — nada a sincronizar aqui`);
    continue;
  }
  mirrored++;
  re.lastIndex = 0;
  const after = before.replace(re, `$1${version}$2`);
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`synced ${file} → ${version}`);
    changed++;
  } else {
    console.log(`${file} already at ${version}`);
  }
}

// Nenhum alvo encontrado significa que este script não está guardando nada —
// erra alto em vez de passar em silêncio e dar a impressão de que sincronizou.
if (mirrored === 0) {
  throw new Error(
    "nenhum arquivo espelho encontrado (server.json, src/version.ts, src/config.ts) — " +
      "o script não está sincronizando nada; ajuste os alvos ou remova o hook",
  );
}
console.log(changed ? `done (${changed} file(s) updated)` : "done (nothing to update)");
