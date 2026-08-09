import { describe, expect, it } from "vitest";
import { checkAuth, timingSafeEqual } from "../src/auth.js";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://exemplo.invalid/mcp", { headers });
}

describe("timingSafeEqual", () => {
  it("iguais → true", async () => {
    expect(await timingSafeEqual("segredo-123", "segredo-123")).toBe(true);
  });

  it("diferentes de mesmo tamanho → false", async () => {
    expect(await timingSafeEqual("segredo-123", "segredo-124")).toBe(false);
  });

  it("tamanhos diferentes → false", async () => {
    expect(await timingSafeEqual("curto", "mais-comprido")).toBe(false);
  });
});

describe("checkAuth", () => {
  it("sem API_KEY configurada → acesso aberto", async () => {
    expect(await checkAuth(req(), undefined)).toBeNull();
  });

  it("sem header Authorization → 401 com WWW-Authenticate", async () => {
    const res = await checkAuth(req(), "chave");
    expect(res?.status).toBe(401);
    expect(res?.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("scheme errado → 401", async () => {
    const res = await checkAuth(req({ Authorization: "Basic abc" }), "chave");
    expect(res?.status).toBe(401);
  });

  it("token errado → 403", async () => {
    const res = await checkAuth(req({ Authorization: "Bearer errada" }), "chave");
    expect(res?.status).toBe(403);
  });

  it("token certo (scheme case-insensitive) → passa", async () => {
    expect(await checkAuth(req({ Authorization: "bearer chave" }), "chave")).toBeNull();
  });
});
