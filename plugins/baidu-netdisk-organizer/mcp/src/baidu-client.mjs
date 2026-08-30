import crypto from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { validateEndpoint } from "./runtime.mjs";

const DEFAULT_REMOTE = "https://mcp-pan.baidu.com/sse";
const DEFAULT_FILE = "https://pan.baidu.com/rest/2.0/xpan/file";
const DEFAULT_MULTIMEDIA = "https://pan.baidu.com/rest/2.0/xpan/multimedia";

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}超时，结果未知；请先回读状态，不要直接重试`);
      error.code = "OUTCOME_UNKNOWN";
      reject(error);
    }, ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}返回了无法解析的 JSON`);
  }
}

function assertBaiduSuccess(response, payload, label) {
  if (!response.ok || Number(payload?.errno) !== 0) {
    const error = new Error(`${label}失败：errno=${payload?.errno ?? response.status}`);
    error.code = "BAIDU_API_ERROR";
    throw error;
  }
}

function filenameOf(item) {
  return item.server_filename || item.filename || path.posix.basename(item.path || "");
}

function itemSnapshot(item) {
  return {
    fsid: String(item.fs_id ?? item.fsid ?? ""),
    path: item.path,
    filename: filenameOf(item),
    isdir: Number(item.isdir ?? (item.category === 6 ? 1 : 0)),
    size: Number(item.size) || 0,
    serverMtime: Number(item.server_mtime ?? item.serverMtime) || 0,
    localMtime: Number(item.local_mtime ?? item.localMtime) || 0,
    md5: item.md5 || null
  };
}

export function inspectRemoteResult(result) {
  const errnos = [];
  const texts = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "errno")) errnos.push(Number(value.errno));
    for (const child of Object.values(value)) visit(child);
  };
  visit(result?.structuredContent);
  for (const content of result?.content || []) {
    if (content.type !== "text") continue;
    const text = String(content.text || "");
    texts.push(text);
    try {
      const parsed = JSON.parse(text.trim());
      visit(parsed);
    } catch {
      for (const match of text.matchAll(/"errno"\s*:\s*(-?\d+)/gu)) errnos.push(Number(match[1]));
    }
  }
  const nonzeroErrnos = [...new Set(errnos.filter((value) => Number.isFinite(value) && value !== 0))];
  return {
    transportError: Boolean(result?.isError),
    reportedError: Boolean(result?.isError) || nonzeroErrnos.length > 0,
    nonzeroErrnos,
    textPreview: texts.join("\n").slice(0, 2000)
  };
}

export function inspectBaiduPayload(payload, responseOk = true) {
  const errnos = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "errno")) errnos.push(Number(value.errno));
    for (const child of Object.values(value)) visit(child);
  };
  visit(payload);
  const nonzeroErrnos = [...new Set(errnos.filter((value) => Number.isFinite(value) && value !== 0))];
  return {
    transportError: !responseOk,
    reportedError: !responseOk || nonzeroErrnos.length > 0,
    nonzeroErrnos
  };
}

export class BaiduClient {
  constructor(token) {
    this.token = token;
    this.remoteBase = validateEndpoint(
      process.env.BAIDU_MCP_REMOTE_URL || DEFAULT_REMOTE,
      "mcp-pan.baidu.com",
      "/sse"
    );
    this.fileBase = validateEndpoint(
      process.env.BAIDU_FILEMANAGER_BASE_URL || DEFAULT_FILE,
      "pan.baidu.com",
      "/rest/2.0/xpan/file"
    );
    this.multimediaBase = validateEndpoint(
      process.env.BAIDU_MULTIMEDIA_BASE_URL || DEFAULT_MULTIMEDIA,
      "pan.baidu.com",
      "/rest/2.0/xpan/multimedia"
    );
    this.remoteClient = null;
    this.remoteTransport = null;
    this.remoteToolNames = null;
  }

  async connectRemote() {
    if (this.remoteClient) return this.remoteClient;
    const endpoint = new URL(this.remoteBase);
    endpoint.searchParams.set("access_token", this.token);
    const transport = new SSEClientTransport(endpoint);
    const client = new Client(
      { name: "codex-baidu-netdisk-organizer-agent", version: "0.1.0" },
      { capabilities: {} }
    );
    await withTimeout(client.connect(transport), 30_000, "百度 MCP 连接");
    const listed = await withTimeout(client.listTools(), 30_000, "百度 MCP 工具发现");
    this.remoteToolNames = new Set(listed.tools.map((tool) => tool.name));
    this.remoteClient = client;
    this.remoteTransport = transport;
    transport.onclose = () => {
      this.remoteClient = null;
      this.remoteTransport = null;
      this.remoteToolNames = null;
    };
    return client;
  }

  async callRemote(name, args) {
    const client = await this.connectRemote();
    if (!this.remoteToolNames.has(name)) throw new Error(`百度官方 MCP 当前未提供工具：${name}`);
    return withTimeout(client.callTool({ name, arguments: args }), 60_000, `百度工具 ${name}`);
  }

  async requestJson(endpoint, options, label) {
    const response = await fetch(endpoint, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(60_000)
    });
    const payload = parseJson(await response.text(), label);
    assertBaiduSuccess(response, payload, label);
    return payload;
  }

  async listDirectory(dir) {
    const output = [];
    for (let start = 0; ; start += 1000) {
      const endpoint = new URL(this.fileBase);
      endpoint.searchParams.set("method", "list");
      endpoint.searchParams.set("access_token", this.token);
      endpoint.searchParams.set("dir", dir);
      endpoint.searchParams.set("start", String(start));
      endpoint.searchParams.set("limit", "1000");
      endpoint.searchParams.set("order", "name");
      endpoint.searchParams.set("desc", "0");
      endpoint.searchParams.set("web", "1");
      const payload = await this.requestJson(endpoint, { method: "GET" }, "目录读取");
      const list = Array.isArray(payload.list) ? payload.list : (payload.data?.list || []);
      output.push(...list);
      if (list.length < 1000) break;
      if (output.length >= 100_000) throw new Error("单个目录超过安全读取上限，无法可靠预检");
    }
    return output;
  }

  async getPathMeta(remotePath) {
    if (remotePath === "/") return { fsid: "root", path: "/", filename: "/", isdir: 1, size: 0, serverMtime: 0, localMtime: 0, md5: null };
    const parent = path.posix.dirname(remotePath);
    const wanted = path.posix.basename(remotePath);
    const found = (await this.listDirectory(parent)).find((item) => filenameOf(item) === wanted && item.path === remotePath);
    return found ? itemSnapshot(found) : null;
  }

  async listAll(remotePath, { start = 0, limit = 1000 } = {}) {
    const endpoint = new URL(this.multimediaBase);
    endpoint.searchParams.set("method", "listall");
    endpoint.searchParams.set("access_token", this.token);
    endpoint.searchParams.set("path", remotePath);
    endpoint.searchParams.set("recursion", "1");
    endpoint.searchParams.set("start", String(start));
    endpoint.searchParams.set("limit", String(limit));
    endpoint.searchParams.set("order", "name");
    endpoint.searchParams.set("desc", "0");
    endpoint.searchParams.set("web", "1");
    return this.requestJson(endpoint, { method: "GET" }, "递归目录读取");
  }

  async summarizePath(remotePath, meta) {
    if (!meta) return null;
    if (!meta.isdir) return { fileCount: 1, directoryCount: 0, bytes: meta.size };
    let start = 0;
    let fileCount = 0;
    let directoryCount = 0;
    let bytes = 0;
    const identity = crypto.createHash("sha256");
    const finish = () => ({
      fileCount,
      directoryCount,
      bytes,
      identityDigest: identity.digest("hex")
    });
    for (let page = 0; page < 1000; page += 1) {
      const payload = await this.listAll(remotePath, { start, limit: 10_000 });
      const list = Array.isArray(payload.list) ? payload.list : [];
      for (const item of list) {
        const snapshot = itemSnapshot(item);
        identity.update(`${JSON.stringify([
          snapshot.fsid,
          snapshot.path,
          snapshot.isdir,
          snapshot.size,
          snapshot.serverMtime,
          snapshot.localMtime,
          snapshot.md5
        ])}\n`);
        if (Number(item.isdir) === 1) directoryCount += 1;
        else {
          fileCount += 1;
          bytes += Number(item.size) || 0;
        }
      }
      const hasMore = Number(payload.has_more) === 1 || payload.has_more === true;
      if (!hasMore) return finish();
      if (list.length === 0) throw new Error("递归读取声称仍有数据但返回空页，拒绝生成不完整摘要");
      if (page === 999) throw new Error("目录递归清单超过安全读取上限，拒绝生成不完整摘要");
      const cursor = Number(payload.cursor);
      const next = Number.isFinite(cursor) && cursor > start ? cursor : start + list.length;
      if (next <= start) throw new Error("递归读取游标没有前进");
      start = next;
    }
    throw new Error("目录递归清单未正常结束，拒绝生成不完整摘要");
  }

  async directDelete(filelist) {
    const endpoint = new URL(this.fileBase);
    endpoint.searchParams.set("method", "filemanager");
    endpoint.searchParams.set("opera", "delete");
    endpoint.searchParams.set("openapi", "xpansdk");
    endpoint.searchParams.set("access_token", this.token);
    const body = new URLSearchParams({
      async: "0",
      ondup: "fail",
      filelist: JSON.stringify(filelist)
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(60_000)
    });
    const payload = parseJson(await response.text(), "删除接口");
    return { responseOk: response.ok, payload };
  }

  async close() {
    if (this.remoteTransport) await this.remoteTransport.close();
  }
}
