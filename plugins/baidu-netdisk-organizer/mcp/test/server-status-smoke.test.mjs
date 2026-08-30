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

test("server starts without a token and exposes a read-only status", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-organizer-no-token-"));
  const childEnv = {
    ...process.env,
    BAIDU_ORGANIZER_STATE_DIR: stateDir,
    BAIDU_SAFETY_CONFIG: path.join(stateDir, "missing-safety.json"),
    BAIDU_LOG_DIR: path.join(stateDir, "logs"),
    BAIDU_NETDISK_ACCESS_TOKEN: "",
    BAIDU_ALLOW_ENV_TOKEN: "",
    BAIDU_TEST_MODE: "",
    BAIDU_MCP_REMOTE_URL: "",
    BAIDU_FILEMANAGER_BASE_URL: "",
    BAIDU_MULTIMEDIA_BASE_URL: ""
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: childEnv
  });
  const client = new Client({ name: "no-token-status-smoke", version: "1.0.0" });

  t.after(async () => {
    try {
      await client.close();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.some((tool) => tool.name === "baidu_organizer_status"), true);

  const statusResult = await client.callTool({
    name: "baidu_organizer_status",
    arguments: { probe_remote: false }
  });
  assert.equal(statusResult.isError, undefined);
  const status = JSON.parse(statusResult.content[0].text);
  assert.equal(status.tokenConfigured, false);
  assert.equal(status.tokenFingerprint, null);
  assert.equal(status.remoteConnected, false);
  assert.equal(status.writesEnabled, false);
  assert.equal(status.deleteEnabled, false);
  assert.deepEqual(status.allowedRoots, ["/CodexOrganizerSandbox"]);

  const noTokenRead = await client.callTool({
    name: "file_list",
    arguments: { dir: "/" }
  });
  assert.equal(noTokenRead.isError, true);
  assert.match(noTokenRead.content[0].text, /尚未配置百度 Access Token/u);
});
