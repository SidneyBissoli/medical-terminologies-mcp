import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root suite = the npm package only. The Worker (worker/) has its own
    // vitest run with its own deps and requires dist/worker-lib.js — letting
    // the root scan pick worker/tests up breaks CI's check job, which runs
    // before any build and never installs worker/node_modules.
    include: ['src/**/*.test.ts'],
  },
});
