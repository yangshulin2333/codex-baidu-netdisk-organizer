import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSecretText, sanitizeSecretValue, validateEndpoint } from "../src/runtime.mjs";

function withEnvironment(name, value, callback) {
  const existed = Object.hasOwn(process.env, name);
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return callback();
  } finally {
    if (existed) process.env[name] = previous;
    else delete process.env[name];
  }
}

test("production endpoints require the exact official HTTPS host and path", { concurrency: false }, () => {
  withEnvironment("BAIDU_TEST_MODE", undefined, () => {
    const accepted = validateEndpoint(
      "https://mcp-pan.baidu.com/sse",
      "mcp-pan.baidu.com",
      "/sse"
    );
    assert.equal(accepted.href, "https://mcp-pan.baidu.com/sse");
    for (const rejected of [
      "http://mcp-pan.baidu.com/sse",
      "https://mcp-pan.baidu.com.evil.example/sse",
      "https://mcp-pan.baidu.com/sse/extra",
      "https://pan.baidu.com/sse",
      "http://127.0.0.1/sse"
    ]) {
      assert.throws(
        () => validateEndpoint(rejected, "mcp-pan.baidu.com", "/sse"),
        /拒绝非官方百度端点/u,
        rejected
      );
    }
  });
});
test("test mode permits loopback endpoints but never arbitrary external hosts", { concurrency: false }, () => {
  withEnvironment("BAIDU_TEST_MODE", "1", () => {
    assert.equal(
      validateEndpoint("http://127.0.0.1:43123/mock", "mcp-pan.baidu.com", "/sse").hostname,
      "127.0.0.1"
    );
    assert.equal(
      validateEndpoint("http://localhost:43123/mock", "mcp-pan.baidu.com", "/sse").hostname,
      "localhost"
    );
    assert.throws(
      () => validateEndpoint("https://attacker.example/sse", "mcp-pan.baidu.com", "/sse"),
      /拒绝非官方百度端点/u
    );
  });
});

test("secret sanitizer redacts raw and URL-encoded token forms", () => {
  const token = "tok+/=?&private-value";
  const encoded = encodeURIComponent(token);
  const output = sanitizeSecretText(`raw=${token}; encoded=${encoded}`, token);
  assert.equal(output.includes(token), false);
  assert.equal(output.includes(encoded), false);
  assert.match(output, /\[REDACTED\]/u);
});

test("secret sanitizer redacts OAuth query, fragment, Bearer, and JSON values", () => {
  const secrets = ["access-value", "refresh-value", "session-value", "client-value", "bearer-value"];
  const input = [
    "https://callback.example/#access_token=access-value&refresh_token=refresh-value",
    "https://callback.example/?session_secret=session-value&client_secret=client-value",
    "Authorization: Bearer bearer-value",
    JSON.stringify({
      access_token: "access-value",
      refresh_token: "refresh-value",
      session_key: "session-value",
      client_secret: "client-value"
    })
  ].join("\n");
  const output = sanitizeSecretText(input);
  for (const secret of secrets) assert.equal(output.includes(secret), false, secret);
  assert.ok((output.match(/\[REDACTED\]/gu) || []).length >= 8);
});

test("structured MCP results are recursively sanitized before returning to the model", () => {
  const token = "structured-secret-token";
  const result = sanitizeSecretValue({
    content: [{ type: "text", text: `Authorization: Bearer ${token}` }],
    structuredContent: { nested: { access_token: token } }
  }, token);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.content[0].text, "Authorization: Bearer [REDACTED]");
  assert.equal(result.structuredContent.nested.access_token, "[REDACTED]");
});
