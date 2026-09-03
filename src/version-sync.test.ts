import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * A versão vive em package.json e é ESPELHADA em outros arquivos: server.json
 * (o manifesto que o MCP Registry lê), o packages[] dentro dele (o pacote npm
 * que a ficha anuncia) e, quando existem, a constante de runtime em
 * src/version.ts ou src/config.ts.
 *
 * Espelho sem guarda diverge em silêncio. Aconteceu duas vezes em 2026-08-27:
 * o ilo publicou a 0.3.1 com o SERVER_CONFIG parado em 0.3.0 — o servidor
 * reportava no handshake uma versão que não existia — e três repositórios
 * tinham o server.json commitado atrasado em vários minor porque o arquivo era
 * reescrito em CI, não no repositório. Nada quebrou, ninguém viu, que é
 * exatamente o defeito.
 *
 * O teste não pina número nenhum: compara os espelhos com a fonte. Quem
 * mantém a sincronia é scripts/sync-version.mjs, no hook `version` do npm.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const pkg = JSON.parse(read("package.json")) as { version: string; name: string };

describe("versão sincronizada entre package.json e seus espelhos", () => {
  it("server.json espelha a versão do package.json", () => {
    if (!existsSync(join(root, "server.json"))) return;
    const srv = JSON.parse(read("server.json")) as { version?: string };
    expect(srv.version).toBe(pkg.version);
  });

  it("cada pacote npm declarado em server.json aponta para esta versão", () => {
    if (!existsSync(join(root, "server.json"))) return;
    const srv = JSON.parse(read("server.json")) as {
      packages?: Array<{ registryType?: string; identifier?: string; version?: string }>;
    };
    // packages[] é opcional — servidor só-remoto não declara caminho npm. Quando
    // declara, a versão precisa existir: o registro oficial recusa a publicação
    // se o pacote não estiver no npm NA VERSÃO DECLARADA.
    for (const p of srv.packages ?? []) {
      if (p.registryType !== "npm") continue;
      expect(p.identifier).toBe(pkg.name);
      expect(p.version).toBe(pkg.version);
    }
  });

  it("a constante de runtime espelha a versão, onde existe", () => {
    for (const file of ["src/version.ts", "src/config.ts"]) {
      if (!existsSync(join(root, file))) continue;
      const m = read(file).match(/(?:export const VERSION = "|\bversion:\s*")(\d+\.\d+\.\d+[^"]*)"/);
      if (!m) continue; // arquivo existe mas não espelha versão: nada a conferir
      expect(m[1], `${file} está fora de sincronia`).toBe(pkg.version);
    }
  });
});

/**
 * Limites do MCP Registry sobre o server.json — o `mcp-publisher validate`
 * roda só no publish, DEPOIS da tag e do npm. Em 2026-09-03 a tag v0.5.0 do
 * ilo-mcp-server falhou no registro com "expected length <= 100" em
 * `description` (139 chars): o npm já tinha publicado, e destravar exigiu
 * `git tag -f`. O limite é do registro (schema oficial), não escolha nossa —
 * vigiá-lo aqui move o erro para antes do bump.
 */
describe("server.json respeita os limites do MCP Registry", () => {
  it("description tem no máximo 100 caracteres", () => {
    if (!existsSync(join(root, "server.json"))) return;
    const srv = JSON.parse(read("server.json")) as { description?: string };
    expect(srv.description, "server.json sem description").toBeTruthy();
    expect(srv.description!.length, `description com ${srv.description!.length} chars`).toBeLessThanOrEqual(100);
  });
});
