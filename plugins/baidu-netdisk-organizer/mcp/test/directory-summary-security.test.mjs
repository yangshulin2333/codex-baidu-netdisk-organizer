import test from "node:test";
import assert from "node:assert/strict";
import { BaiduClient } from "../src/baidu-client.mjs";

function directoryClient(items) {
  const client = Object.create(BaiduClient.prototype);
  client.listAll = async () => ({ list: items, has_more: 0 });
  return client;
}

test("directory identity digest changes when a same-size descendant is replaced", async () => {
  const first = directoryClient([{
    fs_id: 100,
    path: "/Safe/a.txt",
    server_filename: "a.txt",
    isdir: 0,
    size: 42,
    server_mtime: 1000
  }]);
  const replaced = directoryClient([{
    fs_id: 200,
    path: "/Safe/a.txt",
    server_filename: "a.txt",
    isdir: 0,
    size: 42,
    server_mtime: 1000
  }]);
  const meta = { isdir: 1 };
  const firstSummary = await first.summarizePath("/Safe", meta);
  const replacedSummary = await replaced.summarizePath("/Safe", meta);
  assert.equal(firstSummary.fileCount, replacedSummary.fileCount);
  assert.equal(firstSummary.bytes, replacedSummary.bytes);
  assert.notEqual(firstSummary.identityDigest, replacedSummary.identityDigest);
});

test("recursive summary fails closed at its page safety cap", async () => {
  const client = Object.create(BaiduClient.prototype);
  let cursor = 0;
  client.listAll = async () => {
    cursor += 1;
    return {
      list: [{
        fs_id: cursor,
        path: `/Safe/${cursor}.txt`,
        server_filename: `${cursor}.txt`,
        isdir: 0,
        size: 1,
        server_mtime: cursor
      }],
      has_more: 1,
      cursor
    };
  };
  await assert.rejects(
    () => client.summarizePath("/Safe", { isdir: 1 }),
    /超过安全读取上限/u
  );
});
