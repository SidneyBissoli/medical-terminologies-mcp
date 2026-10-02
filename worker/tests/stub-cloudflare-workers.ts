/**
 * Stub de `cloudflare:workers` para a suíte do Worker, que roda em Node.
 *
 * O módulo só é importado por `src/usage.ts`, e só pela CLASSE BASE do Durable
 * Object — nenhum teste instancia um DO (as contas de uso são exercitadas em
 * `usage-core.test.ts`, que é código puro). Sem isto, importar `src/index.ts`
 * quebra na resolução do módulo antes de qualquer teste rodar.
 *
 * O limite deste stub, para ninguém confundir depois: ele torna o ENTRYPOINT
 * importável, não torna o runtime da Cloudflare disponível. Teste que precise
 * de comportamento real de Durable Object, KV ou Analytics Engine não cabe
 * nesta suíte — cabe no `wrangler dev` ou num pool workerd.
 */
export class DurableObject<E = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: E,
  ) {}
}
