import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(testDir, "../src/server.mjs");

test("a persistent quarantine survives startup and blocks prepare tools", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-organizer-quarantine-"));
  const safetyPath = path.join(stateDir, "safety.json");
  const marker = {
    version: 1,
    state: "pending",
    planId: "123e4567-e89b-12d3-a456-426614174000",
    operation: "move",
    startedAt: "2026-08-30T00:00:00.000Z"
  };
  fs.writeFileSync(safetyPath, JSON.stringify({
    allowedRoots: ["/Safe"],
    writesEnabled: true,
    deleteEnabled: true,
    maxBatchSize: 50,
    planTtlSeconds: 600,
    logRetentionDays: 7
  }), "utf8");
  fs.writeFileSync(path.join(stateDir, "write-quarantine.json"), JSON.stringify(marker), "utf8");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
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
  const client = new Client({ name: "quarantine-test", version: "1.0.0" });

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
  const status = JSON.parse(statusResult.content[0].text);
  assert.deepEqual(status.writeQuarantine, {
    active: true,
    state: "pending",
    planId: marker.planId,
    operation: marker.operation,
    startedAt: marker.startedAt
  });

  const prepareResult = await client.callTool({
    name: "prepare_make_dir",
    arguments: { path: "/Safe/NewFolder" }
  });
  assert.equal(prepareResult.isError, true);
  assert.equal(JSON.parse(prepareResult.content[0].text).code, "WRITE_QUARANTINED");
});
