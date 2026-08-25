import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { POLICY_PROFILES, validateTarget } from "./validate.mjs";

const templateUrl = new URL("../../templates/target.template.json", import.meta.url);
const template = JSON.parse(readFileSync(templateUrl, "utf8"));

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INIT_OPTION_NAMES = new Set([
  "candidateName",
  "companyName",
  "domain",
  "intent",
  "locale",
  "now",
  "policyProfile",
  "recipientRole",
  "researchDate",
  "slug",
  "targetRole",
]);

export class TargetInitializationError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = "TargetInitializationError";
    this.code = "TARGET_INITIALIZATION_FAILED";
    this.diagnostics = diagnostics;
  }
}

function inputDiagnostic(code, path, message, details) {
  const result = { severity: "error", code, path, message };
  if (details !== undefined) result.details = details;
  return result;
}

function cloneTemplate() {
  return JSON.parse(JSON.stringify(template));
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function dateFromNow(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new TargetInitializationError("Cannot initialize target: invalid now value.", [
      inputDiagnostic("INIT_DATE_INVALID", "/now", "now must be a valid Date or date-compatible value."),
    ]);
  }
  return date.toISOString().slice(0, 10);
}

/** Return structured diagnostics for a proposed filesystem-safe campaign slug. */
export function validateSlug(slug) {
  const diagnostics = [];
  if (typeof slug !== "string") {
    diagnostics.push(
      inputDiagnostic("SLUG_TYPE", "/slug", "Slug must be a string."),
    );
  } else if (slug.length < 1 || slug.length > 63) {
    diagnostics.push(
      inputDiagnostic("SLUG_LENGTH", "/slug", "Slug must contain 1–63 characters."),
    );
  } else if (!SAFE_SLUG.test(slug)) {
    diagnostics.push(
      inputDiagnostic(
        "SLUG_UNSAFE",
        "/slug",
        "Slug may contain lowercase ASCII letters, digits, and single hyphen separators only.",
      ),
    );
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

/** Return the slug or throw an error with stable, structured diagnostics. */
export function assertSafeSlug(slug) {
  const result = validateSlug(slug);
  if (!result.valid) {
    throw new TargetInitializationError("Cannot initialize target: unsafe slug.", result.diagnostics);
  }
  return slug;
}

/**
 * Resolve child segments under a root while rejecting traversal and ambiguous separators.
 * This is lexical containment; callers must still avoid attacker-controlled symlinks.
 */
export function resolveSafeChildPath(root, ...segments) {
  if (typeof root !== "string" || root.length === 0) {
    throw new TargetInitializationError("Cannot resolve output path: invalid root.", [
      inputDiagnostic("PATH_ROOT_INVALID", "/root", "Output root must be a non-empty string."),
    ]);
  }
  if (segments.length === 0) {
    throw new TargetInitializationError("Cannot resolve output path: no child segment.", [
      inputDiagnostic("PATH_SEGMENT_REQUIRED", "/segments", "At least one child path segment is required."),
    ]);
  }

  for (const [index, segment] of segments.entries()) {
    if (
      typeof segment !== "string" ||
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes("\0") ||
      segment.includes("/") ||
      segment.includes("\\") ||
      isAbsolute(segment)
    ) {
      throw new TargetInitializationError("Cannot resolve output path: unsafe child segment.", [
        inputDiagnostic(
          "PATH_SEGMENT_UNSAFE",
          `/segments/${index}`,
          "Child path segments must be non-empty basenames without separators or traversal tokens.",
        ),
      ]);
    }
  }

  const rootPath = resolve(root);
  const childPath = resolve(rootPath, ...segments);
  const relativePath = relative(rootPath, childPath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..\\`) || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new TargetInitializationError("Cannot resolve output path outside its root.", [
      inputDiagnostic("PATH_OUTSIDE_ROOT", "/segments", "Resolved child path must stay below the output root."),
    ]);
  }
  return childPath;
}

function assertKnownOptions(options) {
  const unknown = Object.keys(options).filter((key) => !INIT_OPTION_NAMES.has(key));
  if (unknown.length > 0) {
    throw new TargetInitializationError("Cannot initialize target: unknown options.",
      unknown.map((key) =>
        inputDiagnostic(
          "INIT_OPTION_UNKNOWN",
          `/${key}`,
          `Unknown initialization option ${JSON.stringify(key)}.`,
        ),
      ),
    );
  }
}

function resolveProfile(options) {
  const intent = options.intent ?? "employment";
  const policyProfile =
    options.policyProfile ??
    (intent === "collaboration" ? "collaboration-cold-v1" : "employment-cold-v1");
  const policy = POLICY_PROFILES[policyProfile];
  return { intent, policyProfile, policy };
}

/**
 * Create a complete, conservative target skeleton. Placeholder evidence is marked unknown.
 * The returned object is schema-valid but is not publication-ready research.
 */
export function initTarget(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TargetInitializationError("Cannot initialize target: options must be an object.", [
      inputDiagnostic("INIT_OPTIONS_TYPE", "/", "Initialization options must be an object."),
    ]);
  }
  assertKnownOptions(options);

  const slug = assertSafeSlug(options.slug ?? "example-company");
  const companyName = options.companyName ?? titleFromSlug(slug);
  const domain = options.domain ?? `${slug}.example.com`;
  const candidateName = options.candidateName ?? "Candidate Name";
  const recipientRole = options.recipientRole ?? "Decision Owner";
  const targetRole = options.targetRole ?? "AI workflow operator";
  const locale = options.locale ?? "en";
  const researchDate = options.researchDate ?? dateFromNow(options.now);
  const { intent, policyProfile, policy } = resolveProfile(options);

  const target = cloneTemplate();
  target.researchDate = researchDate;
  target.campaign.policyProfile = policyProfile;
  target.campaign.intent = intent;
  target.campaign.targetRole = targetRole;
  target.campaign.locales = [locale];
  target.campaign.ctaMinutes = policy?.ctaMinutes ?? (intent === "collaboration" ? 20 : 15);

  target.candidate.name = candidateName;
  target.candidate.role = targetRole;
  target.company.name = companyName;
  target.company.domain = domain;
  target.company.recipientRole = recipientRole;

  for (const source of target.sources) source.accessedAt = researchDate;
  target.sources[0].url = `https://${domain}/`;
  target.sources[1].url = `https://${domain}/services`;
  target.sources[2].url = `https://${domain}/careers`;

  target.pilot.durationDays = policy?.durationDays ?? 30;
  target.pilot.sampleMin = policy?.sampleMin ?? 3;
  target.pilot.sampleMax = policy?.sampleMax ?? 5;

  target.site.title = `A testable AI workflow hypothesis for ${companyName}`;
  target.site.cta = `Would ${target.campaign.ctaMinutes} minutes with the process owner be useful to confirm or disprove three assumptions? No data preparation is needed.`;
  target.privateArtifacts.outreach.subject = `${companyName}: one testable workflow question`;
  target.privateArtifacts.outreach.body = `Hello ${recipientRole},\n\nI am preparing a small, evidence-led work sample for ${companyName}. The current file contains placeholders, not conclusions about your business. Before any outreach, I will replace them with dated public sources, mark each inference, and define one workflow question that a process owner can confirm or reject.\n\nThe final page will show the evidence, unknowns, human decision points, metric, and stop rule without invented ROI. I am exploring ${targetRole} roles where I can own this careful preparation.\n\nWould ${target.campaign.ctaMinutes} minutes be useful once the evidence is complete?\n\n${candidateName}`;

  const result = validateTarget(target, { now: options.now ?? new Date() });
  if (!result.valid) {
    throw new TargetInitializationError(
      "Cannot initialize target: generated data failed validation.",
      result.errors,
    );
  }

  return target;
}
