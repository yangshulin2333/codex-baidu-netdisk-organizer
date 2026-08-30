import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("quarantine creation is exclusive and clearing is bound to the plan id", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-organizer-runtime-quarantine-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  process.env.BAIDU_ORGANIZER_STATE_DIR = stateDir;
  const runtimeUrl = new URL(`../src/runtime.mjs?test=${Date.now()}`, import.meta.url);
  const {
    WRITE_QUARANTINE_PATH,
    clearWriteQuarantine,
    createWriteQuarantine,
    loadWriteQuarantine
  } = await import(runtimeUrl);
  const plan = {
    planId: "123e4567-e89b-12d3-a456-426614174000",
    operation: "rename"
  };

  const created = createWriteQuarantine(plan);
  assert.equal(created.planId, plan.planId);
  assert.equal(fs.existsSync(WRITE_QUARANTINE_PATH), true);
  assert.equal(loadWriteQuarantine().operation, "rename");
  assert.throws(() => createWriteQuarantine(plan), { code: "WRITE_QUARANTINED" });
  assert.throws(
    () => clearWriteQuarantine("00000000-0000-0000-0000-000000000000"),
    { code: "WRITE_QUARANTINED" }
  );
  assert.equal(fs.existsSync(WRITE_QUARANTINE_PATH), true);

  clearWriteQuarantine(plan.planId);
  assert.equal(loadWriteQuarantine(), null);
});
