import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_SECRET_NAMES,
  SECRET_STORE_PATH,
  secretStatus,
  secretsConfigured
} from "../lib/secret-store.mjs";

test("secret store lives outside the repository and exposes status only", () => {
  assert.match(SECRET_STORE_PATH, /EdgeOps[\\/]provider-secrets\.json$/);
  assert.equal(SECRET_STORE_PATH.includes("ShoeGun.github.io"), false);
  const status = secretStatus();
  assert.deepEqual(Object.keys(status).sort(), [...ALLOWED_SECRET_NAMES].sort());
  for (const entry of Object.values(status)) {
    assert.deepEqual(Object.keys(entry).sort(), ["configured", "source"]);
  }
});

test("unknown environment-only names can be checked without entering the store", () => {
  process.env.EDGEOPS_TEST_CREDENTIAL = "present";
  try {
    assert.equal(secretsConfigured(["EDGEOPS_TEST_CREDENTIAL"]), true);
  } finally {
    delete process.env.EDGEOPS_TEST_CREDENTIAL;
  }
});

test("ElevenLabs credentials are supported by the persistent provider store", () => {
  assert.equal(ALLOWED_SECRET_NAMES.includes("ELEVENLABS_API_KEY"), true);
});

test("OpenRouter credentials are supported by the persistent provider store", () => {
  assert.equal(ALLOWED_SECRET_NAMES.includes("OPENROUTER_API_KEY"), true);
});

test("Resemble credentials are supported by the persistent provider store", () => {
  assert.equal(ALLOWED_SECRET_NAMES.includes("RESEMBLE_API_KEY"), true);
});
