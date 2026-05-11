import { describe, it, expect, beforeAll } from 'vitest';
import { promptRegistry } from '../server-core.js';

// Side-effect import — registers the prompts.
import './index.js';

describe('prompts/index registration', () => {
  beforeAll(() => {
    // Module already imported above; this just documents the dependency.
  });

  it('registers find-medical-code', () => {
    expect(promptRegistry.hasPrompt('find-medical-code')).toBe(true);
  });

  it('registers drug-info', () => {
    expect(promptRegistry.hasPrompt('drug-info')).toBe(true);
  });

  it('registers cid10-portuguese-lookup', () => {
    expect(promptRegistry.hasPrompt('cid10-portuguese-lookup')).toBe(true);
  });

  it('every registered prompt has a non-empty description and at least one argument schema entry', () => {
    for (const prompt of promptRegistry.getPrompts()) {
      expect(prompt.description, `prompt "${prompt.name}" missing description`).toBeTruthy();
      // All current prompts take args; if an arg-less prompt is ever added,
      // relax this assertion to `Array.isArray(prompt.arguments)`.
      expect(Array.isArray(prompt.arguments)).toBe(true);
      expect((prompt.arguments ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('prompts/index handlers', () => {
  it('find-medical-code renders the condition into the message text', async () => {
    const handler = promptRegistry.getHandler('find-medical-code');
    expect(handler).toBeDefined();
    const result = await handler!({ condition: 'acute bronchitis', language: 'en' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const content = result.messages[0].content;
    expect(content.type).toBe('text');
    if (content.type !== 'text') throw new Error('unreachable');
    expect(content.text).toContain('acute bronchitis');
    expect(content.text).toContain('icd11_search');
    expect(content.text).toContain('cid10_search');
  });

  it('find-medical-code with pt-BR adds the Portuguese-prioritization line', async () => {
    const handler = promptRegistry.getHandler('find-medical-code');
    const result = await handler!({ condition: 'pneumonia', language: 'pt-BR' });
    const content = result.messages[0].content;
    if (content.type !== 'text') throw new Error('unreachable');
    expect(content.text.toLowerCase()).toContain('portuguese');
    expect(content.text).toContain('pneumonia');
  });

  it('drug-info renders the drug_name into the message text', async () => {
    const handler = promptRegistry.getHandler('drug-info');
    expect(handler).toBeDefined();
    const result = await handler!({ drug_name: 'metformin' });
    const content = result.messages[0].content;
    if (content.type !== 'text') throw new Error('unreachable');
    expect(content.text).toContain('metformin');
    expect(content.text).toContain('rxnorm_search');
    expect(content.text).toContain('atc_classify');
  });

  it('cid10-portuguese-lookup renders the term into the message text in Portuguese', async () => {
    const handler = promptRegistry.getHandler('cid10-portuguese-lookup');
    expect(handler).toBeDefined();
    const result = await handler!({ term: 'infecções respiratórias' });
    const content = result.messages[0].content;
    if (content.type !== 'text') throw new Error('unreachable');
    expect(content.text).toContain('infecções respiratórias');
    expect(content.text).toContain('cid10_search');
    expect(content.text).toContain('Capítulo');
  });

  it('handlers tolerate undefined / missing args without throwing', async () => {
    for (const prompt of promptRegistry.getPrompts()) {
      const handler = promptRegistry.getHandler(prompt.name);
      expect(handler).toBeDefined();
      await expect(handler!({})).resolves.toBeTruthy();
    }
  });
});
