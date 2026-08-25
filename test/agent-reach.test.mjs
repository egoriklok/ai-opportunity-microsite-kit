import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { doctorAgentReach, sanitizeDoctorPayload } from "../src/lib/agent-reach.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/agent-reach-doctor.v1.5.0.json", import.meta.url), "utf8"),
);

test("doctor adapter pins version, avoids a shell, and returns sanitized channel health", () => {
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "version") return { status: 0, stdout: "Agent Reach v1.5.0\n" };
    return { status: 0, stdout: JSON.stringify(fixture) };
  };

  const result = doctorAgentReach({ authorized: true, runner });
  assert.equal(result.ok, true);
  assert.equal(result.version, "1.5.0");
  assert.deepEqual(result.channels, {
    web: { status: "ok", activeBackend: "Jina Reader", available: true },
    github: { status: "ok", activeBackend: "gh CLI", available: true },
  });
  assert.equal(JSON.stringify(result).includes("authenticated status details"), false);
  assert.deepEqual(calls.map((call) => call.args), [["version"], ["doctor", "--json"]]);
  assert.equal(calls.every((call) => call.command === "agent-reach"), true);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(calls.every((call) => call.options.maxBuffer === 256 * 1024), true);
});

test("doctor adapter refuses missing and untested Agent Reach installations", () => {
  const missing = doctorAgentReach({
    runner: () => ({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) }),
  });
  assert.equal(missing.code, "REACH_NOT_INSTALLED");
  assert.equal(missing.ok, false);

  let calls = 0;
  const mismatch = doctorAgentReach({
    runner: () => {
      calls += 1;
      return { status: 0, stdout: "Agent Reach v9.9.9\n" };
    },
  });
  assert.equal(mismatch.code, "REACH_VERSION_MISMATCH");
  assert.equal(calls, 1);
});

test("doctor adapter requires authority before upstream config and network probes", () => {
  let calls = 0;
  const result = doctorAgentReach({
    runner: () => {
      calls += 1;
      return { status: 0, stdout: "Agent Reach v1.5.0\n" };
    },
  });
  assert.equal(result.code, "REACH_AUTHORIZATION_REQUIRED");
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

test("doctor payload drops unsafe channel and backend identifiers", () => {
  const payload = JSON.parse(`{
    "__proto__": {"status": "ok", "active_backend": "evil"},
    "constructor": {"status": "ok", "active_backend": "evil"},
    "prototype": {"status": "ok", "active_backend": "evil"},
    "safe": {"status": "ok", "active_backend": "backend-1", "message": "private"},
    "bilibili": {"status": "ok", "active_backend": "B站搜索 API"},
    "../../unsafe": {"status": "ok", "active_backend": "bad"},
    "strange": {"status": "ok", "active_backend": "<script>"}
  }`);
  const channels = sanitizeDoctorPayload(payload);
  assert.deepEqual(channels, {
    safe: { status: "ok", activeBackend: "backend-1", available: true },
    bilibili: { status: "ok", activeBackend: "B站搜索 API", available: true },
    strange: { status: "ok", activeBackend: null, available: false },
  });
  assert.equal(Object.hasOwn(channels, "__proto__"), false);
  assert.equal(Object.hasOwn(channels, "constructor"), false);
});
