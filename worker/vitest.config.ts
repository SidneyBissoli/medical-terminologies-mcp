import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Ver tests/stub-cloudflare-workers.ts: sem isto, importar o entrypoint
      // (que puxa o Durable Object) falha na resolução, em Node.
      "cloudflare:workers": fileURLToPath(
        // `.href` de propósito: o tsconfig do Worker carrega os tipos da
        // Cloudflare, cujo `URL` global não é o `URL` de node:url que o
        // fileURLToPath espera. Passar a string evita o choque entre os dois.
        new URL("./tests/stub-cloudflare-workers.ts", import.meta.url).href,
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
