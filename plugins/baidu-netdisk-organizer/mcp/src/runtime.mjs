import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateSafetyConfig } from "./safety.mjs";

export const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MCP_DIR = path.dirname(SOURCE_DIR);
export const PLUGIN_DIR = path.dirname(MCP_DIR);
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
export const STATE_DIR = process.env.BAIDU_ORGANIZER_STATE_DIR
  || path.join(localAppData, "BaiduNetdiskOrganizerAgent");
export const CONFIG_PATH = process.env.BAIDU_SAFETY_CONFIG
  || path.join(STATE_DIR, "safety.json");
export const LOG_DIR = process.env.BAIDU_LOG_DIR || path.join(STATE_DIR, "logs");
export const WRITE_QUARANTINE_PATH = path.join(STATE_DIR, "write-quarantine.json");

function writeQuarantineError(message) {
  const error = new Error(message);
  error.code = "WRITE_QUARANTINED";
  return error;
}

function publicQuarantine(value) {
  if (!value) return null;
  return {
    active: true,
    state: value.state,
    planId: value.planId || null,
    operation: value.operation || null,
    startedAt: value.startedAt || null
  };
}

export function loadWriteQuarantine() {
  if (!fs.existsSync(WRITE_QUARANTINE_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(WRITE_QUARANTINE_PATH, "utf8").replace(/^\uFEFF/u, ""));
    const valid = parsed
      && parsed.version === 1
      && parsed.state === "pending"
      && typeof parsed.planId === "string"
      && /^[0-9a-f-]{36}$/iu.test(parsed.planId)
      && ["create", "move", "rename", "delete"].includes(parsed.operation)
      && typeof parsed.startedAt === "string"
      && Number.isFinite(Date.parse(parsed.startedAt));
    if (valid) return publicQuarantine(parsed);
  } catch {
    // A malformed marker must fail closed. It is cleared only by the user-facing recovery script.
  }
  return publicQuarantine({ state: "corrupt" });
}

export function createWriteQuarantine(plan) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const record = {
    version: 1,
    state: "pending",
    planId: plan.planId,
    operation: plan.operation,
    startedAt: new Date().toISOString()
  };
  let descriptor;
  try {
    descriptor = fs.openSync(WRITE_QUARANTINE_PATH, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw writeQuarantineError("检测到未解除的写操作隔离；只能先只读扫描并由用户手工解除");
    }
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return publicQuarantine(record);
}

export function clearWriteQuarantine(planId) {
  const current = loadWriteQuarantine();
  if (!current) return;
  if (current.state !== "pending" || current.planId !== planId) {
    throw writeQuarantineError("写操作隔离标记不属于当前计划；未自动解除");
  }
  fs.unlinkSync(WRITE_QUARANTINE_PATH);
}

export function loadSafetyConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return validateSafetyConfig({
      allowedRoots: ["/CodexOrganizerSandbox"],
      writesEnabled: false,
      deleteEnabled: false,
      maxBatchSize: 50,
      planTtlSeconds: 600,
      logRetentionDays: 7
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("安全配置无法解析；服务已停止，未开放任何写工具");
  }
  return validateSafetyConfig(parsed);
}

export function loadAccessToken() {
  if (process.env.BAIDU_NETDISK_ACCESS_TOKEN) {
    if (process.env.BAIDU_TEST_MODE !== "1" && process.env.BAIDU_ALLOW_ENV_TOKEN !== "1") {
      throw new Error("环境变量令牌默认禁用；Windows 用户请使用 DPAPI 设置脚本");
    }
    return process.env.BAIDU_NETDISK_ACCESS_TOKEN.trim();
  }
  if (process.env.BAIDU_TEST_MODE === "1") return "";
  if (process.platform !== "win32") return "";

  const tokenPath = path.join(STATE_DIR, "access-token.dpapi");
  if (!fs.existsSync(tokenPath)) return "";
  const helper = path.join(PLUGIN_DIR, "scripts", "Get-BaiduNetdiskToken.ps1");
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const modules = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
  try {
    return execFileSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper, "-TokenPath", tokenPath],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PSModulePath: modules }
      }
    ).trim();
  } catch {
    return "";
  }
}

export function tokenFingerprint(token) {
  return token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 8) : null;
}

export function sanitizeSecretText(value, token = "") {
  let text = value instanceof Error ? value.message : String(value ?? "");
  const replacements = [token, token ? encodeURIComponent(token) : ""].filter(Boolean);
  for (const secret of replacements) text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/([?&#](?:access_token|refresh_token|session_key|session_secret|client_secret)=)[^&#\s"']+/giu, "$1[REDACTED]")
    .replace(/("(?:access_token|refresh_token|session_key|session_secret|client_secret)"\s*:\s*")[^"]+/giu, "$1[REDACTED]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s"']+/giu, "$1[REDACTED]");
}

export function sanitizeSecretValue(value, token = "") {
  if (typeof value === "string" || value instanceof Error) return sanitizeSecretText(value, token);
  if (Array.isArray(value)) return value.map((item) => sanitizeSecretValue(item, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:access_token|refresh_token|session_key|session_secret|client_secret)$/iu.test(key)
          ? "[REDACTED]"
          : sanitizeSecretValue(item, token)
      ])
    );
  }
  return value;
}

export function stableErrorCode(error, fallback) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : fallback;
}

export function createAudit(config) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const cutoff = Date.now() - config.logRetentionDays * 86_400_000;
  for (const entry of fs.readdirSync(LOG_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(entry.name)) continue;
    const fullPath = path.join(LOG_DIR, entry.name);
    try {
      if (fs.statSync(fullPath).mtimeMs < cutoff) fs.unlinkSync(fullPath);
    } catch {
      // Log rotation must never affect tool behavior.
    }
  }

  return (event, details = {}) => {
    const safe = {
      timestamp: new Date().toISOString(),
      event,
      tool: details.tool,
      operation: details.operation,
      itemCount: details.itemCount,
      planId: details.planId,
      outcome: details.outcome,
      errorCode: details.errorCode
    };
    const day = safe.timestamp.slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `${day}.jsonl`), `${JSON.stringify(safe)}\n`, "utf8");
  };
}

export function validateEndpoint(rawValue, expectedHost, expectedPath) {
  const url = new URL(rawValue);
  const testMode = process.env.BAIDU_TEST_MODE === "1";
  const localhost = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (testMode && localhost && ["http:", "https:"].includes(url.protocol)) return url;
  const cleanAuthority = !url.username && !url.password && (!url.port || url.port === "443");
  const cleanSuffix = !url.search && !url.hash;
  if (url.protocol !== "https:" || url.hostname !== expectedHost || url.pathname !== expectedPath || !cleanAuthority || !cleanSuffix) {
    throw new Error(`拒绝非官方百度端点：${expectedHost}${expectedPath}`);
  }
  return url;
}
