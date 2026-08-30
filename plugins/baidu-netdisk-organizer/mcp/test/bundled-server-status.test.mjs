import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const bundledServer = path.resolve(testDir, "../dist/server.mjs");

test("committed MCP bundle starts without a token", async (t) => {
  assert.equal(fs.existsSync(bundledServer), true, "run npm run build and commit mcp/dist/server.mjs");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-organizer-bundle-"));
  const safetyPath = path.join(stateDir, "safety.json");
  fs.writeFileSync(safetyPath, `\uFEFF${JSON.stringify({
    allowedRoots: ["/BundleSandbox"],
    writesEnabled: false,
    deleteEnabled: false,
    maxBatchSize: 50,
    planTtlSeconds: 600,
    logRetentionDays: 7
  })}`, "utf8");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundledServer],
    env: {
      ...process.env,
      BAIDU_ORGANIZER_STATE_DIR: stateDir,
      BAIDU_SAFETY_CONFIG: safetyPath,
      BAIDU_LOG_DIR: path.join(stateDir, "logs"),
      BAIDU_NETDISK_ACCESS_TOKEN: "",
      BAIDU_ALLOW_ENV_TOKEN: "",
      BAIDU_TEST_MODE: ""
    }
  });
  const client = new Client({ name: "bundled-status-test", version: "1.0.0" });

  t.after(async () => {
    try {
      await client.close();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await client.connect(transport);
  const statusResult = await client.callTool({
    name: "baidu_organizer_status",
    arguments: { probe_remote: false }
  });
  assert.equal(statusResult.isError, undefined);
  const status = JSON.parse(statusResult.content[0].text);
  assert.equal(status.tokenConfigured, false);
  assert.equal(status.writesEnabled, false);
  assert.equal(status.deleteEnabled, false);
  assert.equal(Object.hasOwn(status, "configPath"), false);
});
