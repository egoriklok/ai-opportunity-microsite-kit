import { spawnSync } from "node:child_process";

export const AGENT_REACH = Object.freeze({
  repository: "https://github.com/Panniantong/Agent-Reach",
  version: "v1.5.0",
  commit: "f65526cbaaad3879473acc1ba6dbefd195caf2be",
  installSource:
    "git+https://github.com/Panniantong/Agent-Reach.git@f65526cbaaad3879473acc1ba6dbefd195caf2be",
});

const INSTALL_HINT =
  `pipx install "${AGENT_REACH.installSource}" (or: uv tool install "${AGENT_REACH.installSource}")`;

function safeBackend(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} ._+()/-]{0,79}$/u.test(normalized) ? normalized : null;
}

export function sanitizeDoctorPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Doctor payload must be an object.");
  }
  const channels = {};
  const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
  for (const [channel, raw] of Object.entries(payload)) {
    if (
      forbiddenKeys.has(channel) ||
      !/^[a-z0-9_-]{1,50}$/.test(channel) ||
      !raw ||
      typeof raw !== "object"
    ) continue;
    const status = ["ok", "warn", "off", "error"].includes(raw.status) ? raw.status : "error";
    const activeBackend = status === "ok" ? safeBackend(raw.active_backend) : null;
    channels[channel] = { status, activeBackend, available: status === "ok" && activeBackend !== null };
  }
  return channels;
}

/** Run Agent Reach's read-only channel health check. */
export function doctorAgentReach({ authorized = false, runner = spawnSync } = {}) {
  const options = {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
    shell: false,
  };
  const versionResult = runner("agent-reach", ["version"], options);

  if (versionResult?.error?.code === "ENOENT") {
    return {
      ok: false,
      installed: false,
      code: "REACH_NOT_INSTALLED",
      message: "Agent Reach is optional and is not installed.",
      installHint: INSTALL_HINT,
      upstream: AGENT_REACH,
    };
  }
  if (versionResult?.error || versionResult?.status !== 0) {
    return {
      ok: false,
      installed: null,
      code: "REACH_EXEC_ERROR",
      message: "Agent Reach version check failed.",
      upstream: AGENT_REACH,
    };
  }

  const installedVersion = String(versionResult.stdout || "").match(/v?([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
  if (installedVersion !== AGENT_REACH.version.slice(1)) {
    return {
      ok: false,
      installed: true,
      code: "REACH_VERSION_MISMATCH",
      message: `Expected Agent Reach ${AGENT_REACH.version}; found ${installedVersion || "unknown"}.`,
      installHint: INSTALL_HINT,
      upstream: AGENT_REACH,
    };
  }

  if (authorized !== true) {
    return {
      ok: false,
      installed: true,
      code: "REACH_AUTHORIZATION_REQUIRED",
      message:
        "Upstream doctor may read Agent Reach config, probe authenticated tools, access the network, and register its skill. Explicit authorization is required.",
      upstream: AGENT_REACH,
    };
  }

  const result = runner("agent-reach", ["doctor", "--json"], options);
  if (result?.error) {
    return {
      ok: false,
      installed: true,
      code: "REACH_EXEC_ERROR",
      message: "Agent Reach doctor could not be executed.",
      upstream: AGENT_REACH,
    };
  }
  if (result?.status !== 0) {
    return {
      ok: false,
      installed: true,
      code: "REACH_DOCTOR_FAILED",
      message: "Agent Reach doctor failed.",
      upstream: AGENT_REACH,
    };
  }

  try {
    return {
      ok: true,
      installed: true,
      code: "REACH_READY",
      version: installedVersion,
      channels: sanitizeDoctorPayload(JSON.parse(String(result.stdout || "{}"))),
      upstream: AGENT_REACH,
    };
  } catch {
    return {
      ok: false,
      installed: true,
      code: "REACH_INVALID_JSON",
      message: "Agent Reach doctor did not return valid JSON.",
      upstream: AGENT_REACH,
    };
  }
}
