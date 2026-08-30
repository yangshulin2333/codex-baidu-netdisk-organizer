import test from "node:test";
import assert from "node:assert/strict";
import {
  isWithinAllowedRoots,
  normalizeOperation,
  validateSafetyConfig
} from "../src/safety.mjs";

const validRawConfig = {
  allowedRoots: ["/OrganizerSandbox"],
  writesEnabled: true,
  deleteEnabled: true,
  maxBatchSize: 10,
  planTtlSeconds: 600,
  logRetentionDays: 7
};

function config(overrides = {}) {
  return validateSafetyConfig({ ...validRawConfig, ...overrides });
}

test("strict config rejects missing required fields and invalid scalar types", () => {
  const missingBatch = { ...validRawConfig };
  delete missingBatch.maxBatchSize;
  assert.throws(() => validateSafetyConfig(missingBatch), /maxBatchSize/u);
  assert.throws(
    () => config({ writesEnabled: "true" }),
    /writesEnabled.*deleteEnabled.*布尔/u
  );
  assert.throws(
    () => config({ writesEnabled: false, deleteEnabled: true }),
    /writesEnabled/u
  );
  assert.throws(() => config({ maxBatchSize: 0 }), /1 到 50/u);
  assert.throws(() => config({ maxBatchSize: 51 }), /1 到 50/u);
});
test("strict config rejects unknown fields instead of silently accepting typos", () => {
  assert.throws(
    () => validateSafetyConfig({ ...validRawConfig, writeEnabled: true }),
    /未知|不支持|多余/u
  );
});

test("write scope rejects the Netdisk root even when it is URL encoded", () => {
  assert.throws(() => config({ allowedRoots: ["/"] }), /根目录/u);
  assert.throws(() => config({ allowedRoots: ["%2F"] }), /根目录/u);
});

test("allowed-root comparison respects path segment boundaries", () => {
  const roots = config().allowedRoots;
  assert.equal(isWithinAllowedRoots("/OrganizerSandbox/a.txt", roots), true);
  assert.equal(isWithinAllowedRoots("/OrganizerSandbox-copy/a.txt", roots), false);
});

test("delete rejects duplicate, encoded duplicate, and parent-child overlap", () => {
  const safe = config();
  assert.throws(
    () => normalizeOperation("delete", {
      filelist: ["/OrganizerSandbox/a", "/OrganizerSandbox/a"]
    }, safe),
    /重复路径/u
  );
  assert.throws(
    () => normalizeOperation("delete", {
      filelist: ["/OrganizerSandbox/a", "%2FOrganizerSandbox%2Fa"]
    }, safe),
    /重复路径/u
  );
  assert.throws(
    () => normalizeOperation("delete", {
      filelist: ["/OrganizerSandbox/folder", "/OrganizerSandbox/folder/child.jpg"]
    }, safe),
    /父路径与子路径/u
  );
});

test("move rejects self-descendants, duplicate sources, and target collisions", () => {
  const safe = config();
  assert.throws(
    () => normalizeOperation("move", {
      filelist: [{
        path: "/OrganizerSandbox/folder",
        dest: "/OrganizerSandbox/folder/child"
      }]
    }, safe),
    /自身或其后代/u
  );
  assert.throws(
    () => normalizeOperation("move", {
      filelist: [
        { path: "/OrganizerSandbox/a.txt", dest: "/OrganizerSandbox/out" },
        { path: "/OrganizerSandbox/a.txt", dest: "/OrganizerSandbox/other" }
      ]
    }, safe),
    /重复路径/u
  );
  assert.throws(
    () => normalizeOperation("move", {
      filelist: [
        { path: "/OrganizerSandbox/a.txt", dest: "/OrganizerSandbox/out", newname: "same.txt" },
        { path: "/OrganizerSandbox/b.txt", dest: "/OrganizerSandbox/out", newname: "same.txt" }
      ]
    }, safe),
    /同一目标路径/u
  );
});

test("rename target must remain inside an allowed root", () => {
  const narrow = validateSafetyConfig({
    allowedRoots: ["/OrganizerSandbox/folder"],
    writesEnabled: true,
    deleteEnabled: false,
    maxBatchSize: 10
  });
  assert.throws(
    () => normalizeOperation("rename", {
      filelist: [{ path: "/OrganizerSandbox/folder", newname: "renamed" }]
    }, narrow),
    /重命名目标路径超出允许写入范围/u
  );
});
