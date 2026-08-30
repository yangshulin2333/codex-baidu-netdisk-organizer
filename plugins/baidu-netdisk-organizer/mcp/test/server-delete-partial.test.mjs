import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(testDir, "../src/server.mjs");

function json(res, value) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

test("direct delete reports nested per-item errno as a partial failure", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-organizer-partial-delete-"));
  const safetyPath = path.join(stateDir, "safety.json");
  fs.writeFileSync(safetyPath, JSON.stringify({
    allowedRoots: ["/OrganizerSandbox"],
    writesEnabled: true,
    deleteEnabled: true,
    maxBatchSize: 10,
    planTtlSeconds: 600,
    logRetentionDays: 7
  }), "utf8");

  const source = {
    fs_id: 123,
    path: "/OrganizerSandbox/a.txt",
    server_filename: "a.txt",
    isdir: 0,
    size: 42,
    server_mtime: 100,
    local_mtime: 100,
    md5: "test-md5"
  };
  let deleteCalls = 0;
  const api = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.searchParams.get("method") === "list") {
      json(res, { errno: 0, list: [source] });
      return;
    }
    if (req.method === "POST" && url.searchParams.get("opera") === "delete") {
      deleteCalls += 1;
      req.resume();
      req.on("end", () => json(res, {
        errno: 0,
        info: [{ path: source.path, errno: -9 }]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  const fileEndpoint = `http://127.0.0.1:${address.port}/rest/2.0/xpan/file`;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      BAIDU_ORGANIZER_STATE_DIR: stateDir,
      BAIDU_SAFETY_CONFIG: safetyPath,
      BAIDU_LOG_DIR: path.join(stateDir, "logs"),
      BAIDU_TEST_MODE: "1",
      BAIDU_ALLOW_ENV_TOKEN: "1",
      BAIDU_NETDISK_ACCESS_TOKEN: "integration-delete-token",
      BAIDU_FILEMANAGER_BASE_URL: fileEndpoint,
      BAIDU_MCP_REMOTE_URL: "https://mcp-pan.baidu.com/sse",
      BAIDU_MULTIMEDIA_BASE_URL: "https://pan.baidu.com/rest/2.0/xpan/multimedia"
    }
  });
  const client = new Client({ name: "delete-partial-test", version: "1.0.0" });

  t.after(async () => {
    try {
      await client.close();
    } finally {
      await new Promise((resolve) => api.close(resolve));
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await client.connect(transport);
  const preparedResult = await client.callTool({
    name: "prepare_delete",
    arguments: { filelist: [source.path] }
  });
  assert.equal(preparedResult.isError, undefined);
  const prepared = JSON.parse(preparedResult.content[0].text);

  const executedResult = await client.callTool({
    name: "execute_operation",
    arguments: {
      plan_id: prepared.plan_id,
      confirmation: prepared.confirmation_required
    }
  });
  assert.equal(executedResult.isError, undefined);
  const executed = JSON.parse(executedResult.content[0].text);
  assert.equal(deleteCalls, 1);
  assert.equal(executed.outcome, "outcome_unknown");
  assert.equal(executed.remote_reported_error, true);
  assert.deepEqual(executed.remote_errnos, [-9]);
  assert.equal(executed.write_quarantine_active, true);
  assert.equal(fs.existsSync(path.join(stateDir, "write-quarantine.json")), true);

  const blockedPrepare = await client.callTool({
    name: "prepare_delete",
    arguments: { filelist: [source.path] }
  });
  assert.equal(blockedPrepare.isError, true);
  assert.equal(JSON.parse(blockedPrepare.content[0].text).code, "WRITE_QUARANTINED");
});
