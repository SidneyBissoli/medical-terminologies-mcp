/**
 * Autenticação Bearer opcional do servidor MCP (extraída do senado-br-mcp-cloudflare).
 *
 * - Comparação em tempo constante (nativa do Workers quando disponível, com
 *   fallback XOR para o runtime Node dos testes).
 * - Sem API_KEY configurada, todas as requisições passam (acesso aberto).
 */

const encoder = new TextEncoder();

/** Comparação de strings em tempo constante. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  // crypto.subtle.timingSafeEqual é extensão do Workers (não existe no WebCrypto do Node).
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aBuf, bBuf);
  }
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) diff |= (aBuf[i] ?? 0) ^ (bBuf[i] ?? 0);
  return diff === 0;
}

/**
 * Checa o Bearer token da requisição.
 *
 * @returns `null` se o auth passa, ou uma `Response` (401/403) se falha.
 */
export async function checkAuth(
  request: Request,
  apiKey: string | undefined,
): Promise<Response | null> {
  // Sem API_KEY configurada — acesso aberto
  if (!apiKey) return null;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Missing Authorization header", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  // Aceita "Bearer <token>" (scheme case-insensitive)
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  if (!match) {
    return new Response("Invalid Authorization format, expected: Bearer <token>", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const token = match[1] ?? "";
  const valid = await timingSafeEqual(token, apiKey);
  if (!valid) {
    return new Response("Invalid token", { status: 403 });
  }

  return null;
}
