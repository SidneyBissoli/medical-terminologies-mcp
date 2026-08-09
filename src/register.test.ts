import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from './register.js';
import {
  SERVER_INSTRUCTIONS,
  toolRegistry,
  promptRegistry,
  resourceRegistry,
} from './server-core.js';

/**
 * End-to-end tests of the MCP protocol surface after the SDK v2 migration.
 * Drives the real server (same `createServer` the stdio entry and the
 * Worker factory use) through a linked in-memory transport and the v2
 * client — no network, no transport-specific code.
 *
 * The registration layer promises surface fidelity: everything the
 * module-level registries hold must come back identically over the wire
 * (names, descriptions, schemas, annotations). These tests pin that
 * contract; the one-off v1×v2 dump comparison of the migration session
 * verified the byte-level equivalence against the last 1.x release.
 */
describe('MCP server protocol surface (SDK v2)', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('sends the server instructions on the handshake (v1.7.0 usability gate)', () => {
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    // The routing map must at least cover the seven terminologies and the
    // honest caveats — pin a few load-bearing fragments so an accidental
    // truncation fails loudly.
    expect(SERVER_INSTRUCTIONS).toContain('find_equivalent');
    expect(SERVER_INSTRUCTIONS).toContain('language: "pt"');
    expect(SERVER_INSTRUCTIONS).toContain('GUIDANCE ONLY');
    expect(SERVER_INSTRUCTIONS).toContain('not clinical decision support');
  });

  it('advertises every registered tool with identical wire fields', async () => {
    const { tools } = await client.listTools();
    const registered = toolRegistry.getTools();

    expect(tools.length).toBe(registered.length);
    // 31 default; 37 only when ENABLE_SNOMED_TOOLS=true (not set in tests).
    expect(tools.length).toBe(31);

    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const reg of registered) {
      const wire = byName.get(reg.name);
      expect(wire, `tool ${reg.name} missing from tools/list`).toBeDefined();
      expect(wire?.title).toBe(reg.title);
      expect(wire?.description).toBe(reg.description);
      // The passthrough registration must advertise the exact JSON Schemas
      // the tool definitions carry — this is the v1×v2 surface contract.
      expect(wire?.inputSchema).toEqual(reg.inputSchema);
      expect(wire?.outputSchema).toEqual(reg.outputSchema);
      expect(wire?.annotations).toEqual(reg.annotations);
    }
  });

  it('marks every tool read-only, idempotent, and open-world', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `tool ${tool.name}`).toBe(true);
      expect(tool.annotations?.destructiveHint, `tool ${tool.name}`).toBe(false);
      expect(tool.annotations?.idempotentHint, `tool ${tool.name}`).toBe(true);
      expect(tool.annotations?.openWorldHint, `tool ${tool.name}`).toBe(true);
    }
  });

  it('every tool carries a non-empty human display title (v1.7.0 usability gate)', async () => {
    // Gates every REGISTERED tool (31 here — the 6 SNOMED-gated tools only
    // register under ENABLE_SNOMED_TOOLS=true; the production smoke's
    // surface dump covers the 37-tool variant)...
    for (const tool of toolRegistry.getTools()) {
      expect(tool.title, `tool ${tool.name} lacks a title`).toBeTruthy();
      expect(tool.title!.trim().length, `tool ${tool.name} title is blank`).toBeGreaterThan(0);
    }
    // ...and at the WIRE level so a registration-layer regression that
    // drops the field is also caught.
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.title, `tool ${tool.name} lacks a wire title`).toBeTruthy();
    }
  });

  it('advertises every registered prompt with its arguments round-tripped', async () => {
    const { prompts } = await client.listPrompts();
    const registered = promptRegistry.getPrompts();

    expect(prompts.length).toBe(registered.length);
    const byName = new Map(prompts.map((p) => [p.name, p]));
    for (const reg of registered) {
      const wire = byName.get(reg.name);
      expect(wire, `prompt ${reg.name} missing from prompts/list`).toBeDefined();
      expect(wire?.description).toBe(reg.description);
      // argsSchema is synthesized from the wire-format arguments list and
      // the SDK derives the list back from it — the round trip must be
      // lossless (name, description, required).
      const wireArgs = (wire?.arguments ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required ?? false,
      }));
      const regArgs = (reg.arguments ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required ?? false,
      }));
      expect(wireArgs).toEqual(regArgs);
    }
  });

  it('advertises every registered resource and serves reads', async () => {
    const { resources } = await client.listResources();
    const registered = resourceRegistry.getResources();

    expect(resources.length).toBe(registered.length);
    const byUri = new Map(resources.map((r) => [r.uri, r]));
    for (const reg of registered) {
      const wire = byUri.get(reg.uri);
      expect(wire, `resource ${reg.uri} missing from resources/list`).toBeDefined();
      expect(wire?.description).toBe(reg.description);
      expect(wire?.mimeType).toBe(reg.mimeType);
    }

    const info = await client.readResource({ uri: 'info://server' });
    const content = info.contents[0];
    expect(content?.uri).toBe('info://server');
    expect(content && 'text' in content ? content.text : undefined).toBeTruthy();
  });

  it('dispatches a bundled-dataset tool call with structuredContent intact', async () => {
    // cid10_search runs fully in-process (bundled DataSUS dataset), so this
    // exercises the whole v2 dispatch path — validation-free passthrough,
    // handler, structuredContent — without any network.
    const result = await client.callTool({
      name: 'cid10_search',
      arguments: { query: 'diabetes' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as { hits: unknown[] };
    expect(Array.isArray(structured.hits)).toBe(true);
    expect(structured.hits.length).toBeGreaterThan(0);
  });

  it('keeps handler-level Zod validation as pedagogical isError results', async () => {
    // The permissive passthrough means the SDK does NOT reject bad args at
    // the protocol layer; the handler's Zod parse produces the friendly
    // error result instead — 1.x behavior preserved.
    const result = await client.callTool({
      name: 'cid10_search',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toContain('Validation error');
  });
});
