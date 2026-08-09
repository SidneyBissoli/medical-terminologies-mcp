import { describe, expect, it } from "vitest";
import { SERVER_CONFIG } from "../src/config.js";
import { buildStatus } from "../src/status.js";

describe("buildStatus", () => {
  it("sem binding version_metadata → sem bloco deploy", () => {
    const status = buildStatus({});
    expect(status).toEqual({
      status: "ok",
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      mcp: SERVER_CONFIG.mcpRoute,
    });
  });

  it("com binding → bloco deploy com id/tag/timestamp", () => {
    const status = buildStatus({
      CF_VERSION_METADATA: { id: "abc123", tag: "", timestamp: "2026-08-06T12:00:00Z" },
    });
    expect(status).toMatchObject({
      deploy: { id: "abc123", tag: null, timestamp: "2026-08-06T12:00:00Z" },
    });
  });
});
