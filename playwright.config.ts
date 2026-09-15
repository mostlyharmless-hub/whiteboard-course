import { defineConfig } from "@playwright/test";

/** 端到端：计时器模式，不依赖 LLM 与音频；开发服务器用 5174 端口以免和手动 `pnpm dev` 冲突 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm dev --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
