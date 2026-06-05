import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Safety net: if anything transitively loads env.ts, give it valid values.
    // (The service tests mock the Firebase layer, so env.ts is not loaded.)
    env: {
      NODE_ENV: 'test',
      SERVER_API_KEY: 'test-key',
      LOG_LEVEL: 'silent',
    },
  },
});
