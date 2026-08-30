const OPERATIONS = new Set(["create", "move", "rename", "delete"]);

export function normalizeNetdiskPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("网盘路径不能为空");
  }

  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("网盘路径不是有效的 URL 编码");
  }

  decoded = decoded.normalize("NFC");
  if (!decoded.startsWith("/")) {
    throw new Error(`必须使用以 / 开头的绝对路径：${decoded}`);
  }
  if (decoded.includes("\\") || /[\u0000-\u001f\u007f]/u.test(decoded)) {
    throw new Error("网盘路径包含不允许的字符");
  }

  const parts = decoded.split("/");
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("网盘路径不能包含 . 或 ..");
  }

  const normalized = `/${parts.filter(Boolean).join("/")}`;
  return normalized === "" ? "/" : normalized;
}

export function validateSafetyConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("安全配置必须是 JSON 对象");
  }

  const required = ["allowedRoots", "writesEnabled", "deleteEnabled", "maxBatchSize"];
  for (const key of required) {
    if (!(key in raw)) throw new Error(`安全配置缺少字段：${key}`);
  }
  const allowed = new Set([...required, "planTtlSeconds", "logRetentionDays"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`安全配置包含未知字段：${unknown.join(", ")}`);
  if (!Array.isArray(raw.allowedRoots) || raw.allowedRoots.length === 0) {
    throw new Error("allowedRoots 必须是非空数组");
  }
  if (typeof raw.writesEnabled !== "boolean" || typeof raw.deleteEnabled !== "boolean") {
    throw new Error("writesEnabled 和 deleteEnabled 必须是布尔值");
  }
  if (raw.deleteEnabled && !raw.writesEnabled) {
    throw new Error("deleteEnabled=true 时 writesEnabled 也必须为 true");
  }
  if (!Number.isInteger(raw.maxBatchSize) || raw.maxBatchSize < 1 || raw.maxBatchSize > 50) {
    throw new Error("maxBatchSize 必须是 1 到 50 的整数");
  }

  const roots = [...new Set(raw.allowedRoots.map(normalizeNetdiskPath))];
  if (roots.includes("/")) {
    throw new Error("公开版安全门禁禁止把网盘根目录 / 设为写入范围；请列出具体顶层目录");
  }

  const planTtlSeconds = raw.planTtlSeconds ?? 600;
  if (!Number.isInteger(planTtlSeconds) || planTtlSeconds < 60 || planTtlSeconds > 3600) {
    throw new Error("planTtlSeconds 必须是 60 到 3600 的整数");
  }
  const logRetentionDays = raw.logRetentionDays ?? 7;
  if (!Number.isInteger(logRetentionDays) || logRetentionDays < 1 || logRetentionDays > 30) {
    throw new Error("logRetentionDays 必须是 1 到 30 的整数");
  }

  return Object.freeze({
    allowedRoots: Object.freeze(roots),
    writesEnabled: raw.writesEnabled,
    deleteEnabled: raw.deleteEnabled,
    maxBatchSize: raw.maxBatchSize,
    planTtlSeconds,
    logRetentionDays
  });
}

export function isWithinAllowedRoots(candidate, roots) {
  const normalized = normalizeNetdiskPath(candidate);
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function assertAllowed(candidate, config, label) {
  const normalized = normalizeNetdiskPath(candidate);
  if (!isWithinAllowedRoots(normalized, config.allowedRoots)) {
    throw new Error(`${label}超出允许写入范围：${normalized}`);
  }
  return normalized;
}

function safeName(value, label = "新文件名") {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}不能为空`);
  const normalized = value.normalize("NFC");
  if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`${label}只能是单个文件名`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error(`${label}包含不允许的字符`);
  return normalized;
}

function assertBatch(items, config) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("操作清单不能为空");
  if (items.length > config.maxBatchSize) {
    throw new Error(`单批最多 ${config.maxBatchSize} 项，本次为 ${items.length} 项`);
  }
}

function assertNoDuplicateOrOverlap(paths) {
  const unique = new Set(paths);
  if (unique.size !== paths.length) throw new Error("操作清单包含重复路径");
  const sorted = [...unique].sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].startsWith(`${sorted[i]}/`)) {
        throw new Error(`操作清单不能同时包含父路径与子路径：${sorted[i]}`);
      }
    }
  }
}

function basename(remotePath) {
  return remotePath.slice(remotePath.lastIndexOf("/") + 1);
}

function dirname(remotePath) {
  const index = remotePath.lastIndexOf("/");
  return index <= 0 ? "/" : remotePath.slice(0, index);
}

export function targetPathFor(item, operation) {
  if (operation === "create") return item.path;
  if (operation === "move") return normalizeNetdiskPath(`${item.dest}/${item.newname || basename(item.path)}`);
  if (operation === "rename") return normalizeNetdiskPath(`${dirname(item.path)}/${item.newname}`);
  return undefined;
}

export function normalizeOperation(operation, rawArgs, config) {
  if (!OPERATIONS.has(operation)) throw new Error(`不支持的操作：${operation}`);
  const args = structuredClone(rawArgs ?? {});

  if (operation === "create") {
    const path = assertAllowed(args.path, config, "新目录");
    return { operation, items: [{ path }] };
  }

  assertBatch(args.filelist, config);
  let items;
  if (operation === "delete") {
    items = args.filelist.map((value) => ({ path: assertAllowed(value, config, "删除路径") }));
  } else if (operation === "rename") {
    items = args.filelist.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("重命名项必须是对象");
      const path = assertAllowed(item.path, config, "重命名路径");
      const newname = safeName(item.newname);
      const target = assertAllowed(targetPathFor({ path, newname }, "rename"), config, "重命名目标路径");
      if (target === path) throw new Error(`新旧名称相同：${path}`);
      return { path, newname };
    });
  } else {
    items = args.filelist.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("移动项必须是对象");
      const path = assertAllowed(item.path, config, "移动源路径");
      const dest = assertAllowed(item.dest, config, "移动目标目录");
      const newname = item.newname === undefined ? undefined : safeName(item.newname);
      const target = normalizeNetdiskPath(`${dest}/${newname || basename(path)}`);
      if (target === path || target.startsWith(`${path}/`)) {
        throw new Error(`不能把目录移动到自身或其后代：${path}`);
      }
      return { path, dest, ...(newname ? { newname } : {}) };
    });
  }

  assertNoDuplicateOrOverlap(items.map((item) => item.path));
  const targets = items.map((item) => targetPathFor(item, operation)).filter(Boolean);
  if (new Set(targets).size !== targets.length) throw new Error("多个项目不能写入同一目标路径");
  return { operation, items };
}

export function assertMutationEnabled(operation, config) {
  if (!config.writesEnabled) throw new Error("写操作门禁尚未启用");
  if (operation === "delete" && !config.deleteEnabled) throw new Error("删除门禁尚未启用");
}

export function remoteArgumentsFor(plan) {
  if (plan.operation === "create") {
    return { path: plan.items[0].path, rtype: "0" };
  }
  const filelist = plan.items.map((item) => {
    if (plan.operation === "delete") return item.path;
    return { ...item };
  });
  return {
    filelist: JSON.stringify(filelist),
    async: 0,
    ondup: "fail"
  };
}
