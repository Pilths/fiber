import { defineConfig } from "@playwright/test";

// Runs against the running Compose stack (dev seed data). Inside the web container: http://localhost:5173.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173" },
});
