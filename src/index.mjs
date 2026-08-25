export {
  TargetInitializationError,
  assertSafeSlug,
  initTarget,
  resolveSafeChildPath,
  validateSlug,
} from "./lib/init.mjs";
export { POLICY_PROFILES, countWords, validateTarget } from "./lib/validate.mjs";
export { renderTarget } from "./lib/render.mjs";
export { AGENT_REACH, doctorAgentReach, sanitizeDoctorPayload } from "./lib/agent-reach.mjs";
export { installCodexSkill } from "./lib/codex-skill.mjs";
export {
  WORKSPACE_ERROR_CODES,
  WorkspaceInitializationError,
  initWorkspace,
} from "./lib/workspace.mjs";
