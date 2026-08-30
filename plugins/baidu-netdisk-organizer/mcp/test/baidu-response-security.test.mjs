import test from "node:test";
import assert from "node:assert/strict";
import { inspectRemoteResult } from "../src/baidu-client.mjs";

test("nested per-item errno turns a top-level success into a reported partial failure", () => {
  const result = inspectRemoteResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        errno: 0,
        info: [
          { path: "/a", errno: 0 },
          { path: "/b", errno: -9 },
          { path: "/c", result: { errno: 12 } }
        ]
      })
    }]
  });
  assert.equal(result.transportError, false);
  assert.equal(result.reportedError, true);
  assert.deepEqual(result.nonzeroErrnos, [-9, 12]);
});
test("duplicate nested errnos are de-duplicated and transport errors remain errors", () => {
  const result = inspectRemoteResult({
    isError: true,
    content: [{ type: "text", text: '{"errno":-7,"nested":{"errno":-7}}' }]
  });
  assert.equal(result.transportError, true);
  assert.equal(result.reportedError, true);
  assert.deepEqual(result.nonzeroErrnos, [-7]);
});

test("errno is still detected in non-JSON text responses", () => {
  const result = inspectRemoteResult({
    content: [{ type: "text", text: 'prefix {"errno": -30} suffix' }]
  });
  assert.equal(result.reportedError, true);
  assert.deepEqual(result.nonzeroErrnos, [-30]);
});

test("structuredContent errno is inspected even when no text block is present", () => {
  const result = inspectRemoteResult({
    structuredContent: {
      errno: 0,
      info: [{ errno: 0 }, { errno: -11 }]
    },
    content: []
  });
  assert.equal(result.reportedError, true);
  assert.deepEqual(result.nonzeroErrnos, [-11]);
});
