import test from "node:test";
import assert from "node:assert/strict";
import { updateStatus, validateAuth } from "./model.js";
test("retry updates the original message without duplicating it or touching other chats", () => {
  const original = [
    { id: "a", messages: [{ id: "m", status: "failed" }] },
    { id: "b", messages: [{ id: "n", status: "sent" }] },
  ];
  const next = updateStatus(updateStatus(original, "a", "m", "sending"), "a", "m", "sent");
  assert.equal(next[0].messages.length, 1);
  assert.equal(next[0].messages[0].status, "sent");
  assert.equal(original[0].messages[0].status, "failed");
  assert.equal(next[1], original[1]);
});
test("auth rejects invalid fields and accepts valid signup", () => {
  assert.equal(Object.keys(validateAuth({ email: "x", password: "123", name: "" }, true)).length, 3);
  assert.deepEqual(validateAuth({ email: "alex@example.com", password: "password123", name: "Alex" }, true), {});
});
