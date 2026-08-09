/**
 * Platform-agnostic MCP server core — runs unchanged on Node (stdio) and
 * Cloudflare Workers. Holds the three singleton registries that tool/
 * prompt/resource modules populate at load time, plus SERVER_INFO and the
 * shared handler types.
 *
 * Since the SDK v2 migration the actual `McpServer` construction lives in
 * `src/register.ts` (`createServer` / `registerAll`), which imports every
 * tool/prompt/resource module for its side effects and then projects the
 * registries onto a `McpServer`. This file must NOT import those modules —
 * they import the registries from here, and a cycle would hit the TDZ.
 */

import type {
  Tool,
  CallToolResult,
  Prompt,
  GetPromptResult,
  Resource,
  ReadResourceResult,
} from '@modelcontextprotocol/server';
import pkg from '../package.json';

export const SERVER_INFO = {
  name: pkg.name,
  version: pkg.version,
  description: 'Unified MCP server for seven medical terminologies (ICD-11, SNOMED CT, LOINC, RxNorm, MeSH, ATC, CID-10) with authoritative WHO ICD-10→ICD-11 mapping. 37 tools, hosted endpoint available, MIT.',
} as const;

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;
export type PromptHandler = (args: Record<string, string | undefined>) => Promise<GetPromptResult>;
export type ResourceHandler = (uri: string) => Promise<ReadResourceResult>;

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  register(tool: Tool, handler: ToolHandler): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

class PromptRegistry {
  private prompts: Map<string, Prompt> = new Map();
  private handlers: Map<string, PromptHandler> = new Map();

  register(prompt: Prompt, handler: PromptHandler): void {
    this.prompts.set(prompt.name, prompt);
    this.handlers.set(prompt.name, handler);
  }

  getPrompts(): Prompt[] {
    return Array.from(this.prompts.values());
  }

  getHandler(name: string): PromptHandler | undefined {
    return this.handlers.get(name);
  }

  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }
}

class ResourceRegistry {
  private resources: Map<string, Resource> = new Map();
  private handlers: Map<string, ResourceHandler> = new Map();

  register(resource: Resource, handler: ResourceHandler): void {
    this.resources.set(resource.uri, resource);
    this.handlers.set(resource.uri, handler);
  }

  getResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  getHandler(uri: string): ResourceHandler | undefined {
    return this.handlers.get(uri);
  }

  hasResource(uri: string): boolean {
    return this.resources.has(uri);
  }
}

export const toolRegistry = new ToolRegistry();
export const promptRegistry = new PromptRegistry();
export const resourceRegistry = new ResourceRegistry();
