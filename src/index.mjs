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
