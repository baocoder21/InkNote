import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: a real Chrome against the WHOLE system running in Docker (nginx -> API -> PostgreSQL + MinIO).
 *
 *   1. Start the system (from the repository root, with JWT_KEY in .env; see .env.example):
 *        docker compose --profile app up -d --build
 *   2. From src/frontend:   npm run e2e
 *
 * Settings (environment variables):
 *   E2E_BASE_URL     where the web server is        (default http://localhost:8080)
 *   E2E_STORAGE_URL  where the browser downloads files from (default http://localhost:9000)
 *
 * Each test registers its OWN new account, so tests never depend on each other or on existing data. They do leave those
 * accounts behind: run against a separate database if you care (POSTGRES_DB=inknote_e2e in .env).
 * It must be the production build behind nginx: the offline test needs the service worker, which `ng serve` does not have.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One at a time: the tests are slow and share one server; a few seconds more are worth the calm.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e-results',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    // The Chrome that is installed on the machine (no browser download needed).
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 780 },
    trace: 'retain-on-failure',
  },
});
