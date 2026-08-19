import assert from "node:assert/strict";
import test from "node:test";

import { assertExactLocalMutation } from "../lib/local-mutation-boundary.mjs";

const request = (headers, remoteAddress = "127.0.0.1") => ({ method: "POST", headers, socket: { remoteAddress } });
const valid = {
  host: "127.0.0.1:3210",
  origin: "http://127.0.0.1:3210",
  "content-type": "application/json; charset=utf-8",
};

test("3210 privileged deputy requires exact loopback authority, origin, JSON, and its own authorization", () => {
  assert.doesNotThrow(() => assertExactLocalMutation(request(valid), { authorized: true }));
  for (const [headers, remoteAddress, code] of [
    [{ ...valid, host: "desktop-6he0t2k.taile5e8da.ts.net" }, "127.0.0.1", "EDGEOPS_HOST_REJECTED"],
    [{ ...valid, origin: "https://desktop-6he0t2k.taile5e8da.ts.net" }, "127.0.0.1", "EDGEOPS_ORIGIN_REJECTED"],
    [{ ...valid, "content-type": "text/plain" }, "127.0.0.1", "EDGEOPS_JSON_REQUIRED"],
    [valid, "100.64.0.2", "EDGEOPS_LOOPBACK_REQUIRED"],
  ]) {
    assert.throws(() => assertExactLocalMutation(request(headers, remoteAddress), { authorized: true }), (error) => error.code === code);
  }
  assert.throws(() => assertExactLocalMutation(request(valid), { authorized: false }), (error) => error.code === "EDGEOPS_CONTROL_UNAUTHORIZED");
});
