/**
 * Rate limit de entrada por cliente — token bucket em memória, por isolate
 * (generalizado do throttle do senado-br-mcp-cloudflare).
 *
 * Escopo deliberado: proteção contra burst/abuso acidental, barata e sem I/O no
 * caminho crítico. NÃO é um limite global exato — cada isolate tem seus próprios
 * buckets e eles zeram quando o isolate recicla. Para um teto global rígido,
 * mover a contagem para um Durable Object (o UsageTracker é um ponto natural).
 */

import { RATE_LIMIT } from "./config.js";

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number, // tokens por segundo
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Segundos (inteiros, mínimo 1) até haver 1 token — para o header Retry-After. */
  retryAfterSeconds(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.max(1, Math.ceil((1 - this.tokens) / this.refillRate));
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

/** Buckets por cliente (chave = IP via CF-Connecting-IP), com evicção FIFO. */
const clientBuckets = new Map<string, TokenBucket>();

export interface RateLimitDecision {
  allowed: boolean;
  /** Presente (>0) quando bloqueado — valor para o header Retry-After. */
  retryAfterS: number;
}

export function checkRateLimit(clientId: string): RateLimitDecision {
  let bucket = clientBuckets.get(clientId);
  if (!bucket) {
    if (clientBuckets.size >= RATE_LIMIT.maxClientBuckets) {
      const firstKey = clientBuckets.keys().next().value;
      if (firstKey !== undefined) clientBuckets.delete(firstKey);
    }
    bucket = new TokenBucket(RATE_LIMIT.clientBurst, RATE_LIMIT.clientRefillPerSec);
    clientBuckets.set(clientId, bucket);
  }
  if (bucket.tryConsume()) return { allowed: true, retryAfterS: 0 };
  return { allowed: false, retryAfterS: bucket.retryAfterSeconds() };
}

/** Zera o estado — somente para testes. */
export function _resetRateLimit(): void {
  clientBuckets.clear();
}
