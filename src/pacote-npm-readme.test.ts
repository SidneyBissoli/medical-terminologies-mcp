/**
 * O pacote do npm leva UM README só — o `README.md`, em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 2026-10-02 a página do npm deste pacote
 * mostrava o README em PORTUGUÊS (`README.pt-BR.md`). O npm empacota SEMPRE
 * todo `README*` da raiz, ignorando o campo `files` — inclusive a negação
 * `!README.pt-BR.md`, testada no uis-mcp-server —, e entre dois escolheu o par
 * traduzido. A mesma classe estava em seis dos oito pacotes do portfólio. O
 * par em português agora se chama `LEIA-ME.md`, fora do padrão; este teste
 * prende o pacote real (`npm pack --dry-run`), não a convenção de nome.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('README no pacote do npm', () => {
  it('o tarball leva exatamente um README, e é o README.md', () => {
    const saida = execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [pacote] = JSON.parse(saida) as [{ files: Array<{ path: string }> }];
    const readmes = pacote.files.map((f) => f.path).filter((p) => /^readme/i.test(p));
    expect(readmes, 'o npm exibe um README só; com dois, escolheu o traduzido').toEqual(['README.md']);
  }, 60_000);
});
