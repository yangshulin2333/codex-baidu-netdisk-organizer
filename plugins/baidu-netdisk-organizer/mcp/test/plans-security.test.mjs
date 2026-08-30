import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PlanStore } from "../src/plans.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();
}

function createDeletePlan(store) {
  const items = [{ path: "/OrganizerSandbox/a.txt" }];
  const snapshots = [{
    source: {
      fsid: "123",
      path: "/OrganizerSandbox/a.txt",
      isdir: 0,
      size: 42,
      serverMtime: 100
    }
  }];
  const summary = { files: 1, directories: 0, bytes: 42 };
  return { plan: store.create("delete", items, snapshots, summary), items, snapshots };
}

test("confirmation hash is bound to operation, items, snapshots, time, and plan id", () => {
  const store = new PlanStore(600);
  const { plan, items, snapshots } = createDeletePlan(store);
  const expected = sha256({
    operation: "delete",
    items,
    snapshots,
    createdAt: plan.createdAt,
    planId: plan.planId
  });
  assert.equal(plan.hash, expected);
  assert.equal(plan.confirmation, `DELETE:1:${expected.slice(0, 8)}`);
});
test("authorization rejects a confirmation copied from a different plan", () => {
  const store = new PlanStore(600);
  const first = createDeletePlan(store).plan;
  const second = createDeletePlan(store).plan;
  assert.notEqual(first.confirmation, second.confirmation);
  assert.throws(
    () => store.authorize(second.planId, first.confirmation),
    /确认文字不匹配/u
  );
  try {
    store.authorize(second.planId, first.confirmation);
    assert.fail("authorization should have failed");
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(second.confirmation, "u"));
  }
});

test("plans expire exactly at their TTL boundary", { concurrency: false }, () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const store = new PlanStore(60);
    const plan = createDeletePlan(store).plan;
    now = plan.expiresAt - 1;
    assert.equal(store.get(plan.planId), plan);
    now = plan.expiresAt;
    assert.throws(() => store.get(plan.planId), /不存在或已过期/u);
  } finally {
    Date.now = originalNow;
  }
});

test("a used plan is single-use", () => {
  const store = new PlanStore(600);
  const plan = createDeletePlan(store).plan;
  assert.equal(store.authorize(plan.planId, plan.confirmation), plan);
  store.markUsed(plan.planId);
  assert.throws(
    () => store.authorize(plan.planId, plan.confirmation),
    /已经执行过/u
  );
});
