import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaUrl = new URL("../../schema/target.schema.json", import.meta.url);
const targetSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: false,
  coerceTypes: false,
  strict: true,
  strictSchema: true,
  strictTuples: false,
  useDefaults: false,
  validateFormats: true,
});

addFormats(ajv, { mode: "full" });

const validateSchema = ajv.compile(targetSchema);

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY_ORDER = { error: 0, warning: 1 };

const POLICY_PROFILES = Object.freeze({
  "employment-cold-v1": Object.freeze({
    intent: "employment",
    ctaMinutes: 15,
    durationDays: 30,
    sampleMin: 3,
    sampleMax: 5,
  }),
  "collaboration-cold-v1": Object.freeze({
    intent: "collaboration",
    ctaMinutes: 20,
    durationDays: 30,
    sampleMin: 3,
    sampleMax: 5,
  }),
  "custom-v1": null,
});

const OVERCLAIM_PATTERNS = Object.freeze([
  /\bguarantee(?:d|s)?\b/i,
  /\bproven\s+(?:roi|return|result|results)\b/i,
  /\b(?:will|always)\s+(?:increase|reduce|save|eliminate|deliver|transform)\b/i,
  /\bzero\s+risk\b/i,
  /\b100\s*%\b/i,
]);

function pointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(base, value) {
  return `${base}/${pointerToken(value)}`;
}

function diagnostic(severity, code, path, message, details) {
  const result = { severity, code, path: path || "/", message };
  if (details !== undefined) result.details = details;
  return result;
}

function schemaDiagnostic(error) {
  let path = error.instancePath || "";
  if (error.keyword === "required" && error.params?.missingProperty) {
    path = childPointer(path, error.params.missingProperty);
  }
  if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
    path = childPointer(path, error.params.additionalProperty);
  }

  return diagnostic(
    "error",
    `SCHEMA_${String(error.keyword).replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`,
    path,
    error.message ? `Schema ${error.message}.` : "Schema validation failed.",
    error.params,
  );
}

function compareDiagnostics(left, right) {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function addDuplicateDiagnostics(items, basePath, kind, diagnostics) {
  const firstIndexById = new Map();
  for (const [index, item] of safeArray(items).entries()) {
    const id = isRecord(item) ? item.id : undefined;
    if (typeof id !== "string") continue;
    if (firstIndexById.has(id)) {
      diagnostics.push(
        diagnostic(
          "error",
          `DUPLICATE_${kind}_ID`,
          `${basePath}/${index}/id`,
          `${kind.toLowerCase()} ID ${JSON.stringify(id)} is duplicated.`,
          { id, firstIndex: firstIndexById.get(id), duplicateIndex: index },
        ),
      );
    } else {
      firstIndexById.set(id, index);
    }
  }
  return new Set(firstIndexById.keys());
}

function addReferenceDiagnostics(target, diagnostics) {
  const sourceIds = addDuplicateDiagnostics(target?.sources, "/sources", "SOURCE", diagnostics);
  const signalIds = addDuplicateDiagnostics(target?.signals, "/signals", "SIGNAL", diagnostics);
  const opportunityIds = addDuplicateDiagnostics(
    target?.opportunities,
    "/opportunities",
    "OPPORTUNITY",
    diagnostics,
  );

  for (const [signalIndex, signal] of safeArray(target?.signals).entries()) {
    for (const [refIndex, ref] of safeArray(signal?.sourceRefs).entries()) {
      if (typeof ref === "string" && !sourceIds.has(ref)) {
        diagnostics.push(
          diagnostic(
            "error",
            "SIGNAL_SOURCE_REF_UNKNOWN",
            `/signals/${signalIndex}/sourceRefs/${refIndex}`,
            `Signal source reference ${JSON.stringify(ref)} does not match a source ID.`,
            { ref },
          ),
        );
      }
    }
  }

  for (const [opportunityIndex, opportunity] of safeArray(target?.opportunities).entries()) {
    if (
      typeof opportunity?.observedSignal === "string" &&
      !signalIds.has(opportunity.observedSignal)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "OPPORTUNITY_SIGNAL_REF_UNKNOWN",
          `/opportunities/${opportunityIndex}/observedSignal`,
          `Observed signal ${JSON.stringify(opportunity.observedSignal)} does not match a signal ID.`,
          { ref: opportunity.observedSignal },
        ),
      );
    }

    for (const [refIndex, ref] of safeArray(opportunity?.evidenceRefs).entries()) {
      if (typeof ref === "string" && !sourceIds.has(ref)) {
        diagnostics.push(
          diagnostic(
            "error",
            "OPPORTUNITY_EVIDENCE_REF_UNKNOWN",
            `/opportunities/${opportunityIndex}/evidenceRefs/${refIndex}`,
            `Opportunity evidence reference ${JSON.stringify(ref)} does not match a source ID.`,
            { ref },
          ),
        );
      }
    }
  }

  if (
    typeof target?.selectedOpportunityId === "string" &&
    !opportunityIds.has(target.selectedOpportunityId)
  ) {
    diagnostics.push(
      diagnostic(
        "error",
        "SELECTED_OPPORTUNITY_UNKNOWN",
        "/selectedOpportunityId",
        `Selected opportunity ${JSON.stringify(target.selectedOpportunityId)} does not match an opportunity ID.`,
        { ref: target.selectedOpportunityId },
      ),
    );
  }
}

function expectedDecision(total) {
  if (total >= 16) return "microsite";
  if (total >= 12) return "brief";
  return "research-or-stop";
}

function addTargetScoreDiagnostics(target, diagnostics) {
  const scores = target?.targetScreen?.scores;
  if (!isRecord(scores)) return;

  const values = Object.values(scores);
  if (!values.every(Number.isInteger)) return;

  const calculatedTotal = values.reduce((sum, value) => sum + value, 0);
  const statedTotal = target?.targetScreen?.total;
  if (Number.isInteger(statedTotal) && statedTotal !== calculatedTotal) {
    diagnostics.push(
      diagnostic(
        "error",
        "TARGET_SCORE_TOTAL_MISMATCH",
        "/targetScreen/total",
        `Target score total must equal the score sum (${calculatedTotal}).`,
        { expected: calculatedTotal, actual: statedTotal },
      ),
    );
  }

  const decision = target?.targetScreen?.decision;
  const expected = expectedDecision(calculatedTotal);
  if (typeof decision === "string" && decision !== expected) {
    diagnostics.push(
      diagnostic(
        "error",
        "TARGET_DECISION_MISMATCH",
        "/targetScreen/decision",
        `A score of ${calculatedTotal} requires decision ${JSON.stringify(expected)}.`,
        { expected, actual: decision, total: calculatedTotal },
      ),
    );
  }
  if (decision === expected && decision !== "microsite") {
    diagnostics.push(
      diagnostic(
        "warning",
        "TARGET_NOT_PUBLICATION_READY",
        "/targetScreen/decision",
        "The target is structurally valid but not approved for a public microsite.",
        { decision, total: calculatedTotal },
      ),
    );
  }
}

function addPolicyDiagnostics(target, diagnostics) {
  const profileName = target?.campaign?.policyProfile;
  const profile = POLICY_PROFILES[profileName];
  if (!profile) return;

  const checks = [
    ["/campaign/intent", target?.campaign?.intent, profile.intent],
    ["/campaign/ctaMinutes", target?.campaign?.ctaMinutes, profile.ctaMinutes],
    ["/pilot/durationDays", target?.pilot?.durationDays, profile.durationDays],
    ["/pilot/sampleMin", target?.pilot?.sampleMin, profile.sampleMin],
    ["/pilot/sampleMax", target?.pilot?.sampleMax, profile.sampleMax],
  ];

  for (const [path, actual, expected] of checks) {
    if (actual !== undefined && actual !== expected) {
      diagnostics.push(
        diagnostic(
          "error",
          "POLICY_PROFILE_MISMATCH",
          path,
          `${profileName} requires ${path.split("/").at(-1)}=${JSON.stringify(expected)}.`,
          { profile: profileName, expected, actual },
        ),
      );
    }
  }
}

function addPilotDiagnostics(target, diagnostics) {
  const minimum = target?.pilot?.sampleMin;
  const maximum = target?.pilot?.sampleMax;
  if (Number.isInteger(minimum) && Number.isInteger(maximum) && minimum > maximum) {
    diagnostics.push(
      diagnostic(
        "error",
        "PILOT_SAMPLE_RANGE_INVALID",
        "/pilot/sampleMax",
        "Pilot sampleMax must be greater than or equal to sampleMin.",
        { sampleMin: minimum, sampleMax: maximum },
      ),
    );
  }
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeToday(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("validateTarget option now must be a valid Date or date-compatible value.");
  }
  return Date.parse(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function addOneDateDiagnostic(value, path, label, today, staleAfterDays, diagnostics) {
  const timestamp = parseIsoDate(value);
  if (timestamp === null) return;
  const ageDays = Math.floor((today - timestamp) / DAY_MS);

  if (ageDays < 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "DATE_IN_FUTURE",
        path,
        `${label} cannot be in the future.`,
        { value, today: new Date(today).toISOString().slice(0, 10) },
      ),
    );
  } else if (ageDays > staleAfterDays) {
    diagnostics.push(
      diagnostic(
        "warning",
        "DATE_STALE",
        path,
        `${label} is ${ageDays} days old; refresh or explicitly justify it.`,
        { value, ageDays, staleAfterDays },
      ),
    );
  }
}

function addDateDiagnostics(target, options, diagnostics) {
  const staleAfterDays = options.staleAfterDays ?? 365;
  if (!Number.isInteger(staleAfterDays) || staleAfterDays < 0) {
    throw new TypeError("validateTarget option staleAfterDays must be a non-negative integer.");
  }

  const today = normalizeToday(options.now ?? new Date());
  addOneDateDiagnostic(
    target?.researchDate,
    "/researchDate",
    "Research date",
    today,
    staleAfterDays,
    diagnostics,
  );

  const researchTimestamp = parseIsoDate(target?.researchDate);
  for (const [index, source] of safeArray(target?.sources).entries()) {
    const path = `/sources/${index}/accessedAt`;
    addOneDateDiagnostic(
      source?.accessedAt,
      path,
      "Source access date",
      today,
      staleAfterDays,
      diagnostics,
    );

    const sourceTimestamp = parseIsoDate(source?.accessedAt);
    if (
      researchTimestamp !== null &&
      sourceTimestamp !== null &&
      sourceTimestamp > researchTimestamp
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "SOURCE_DATE_AFTER_RESEARCH",
          path,
          "Source access date cannot be after the declared research date.",
          { accessedAt: source.accessedAt, researchDate: target.researchDate },
        ),
      );
    }
  }
}

export function countWords(value) {
  if (typeof value !== "string") return 0;
  return value.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function addOutreachDiagnostics(target, diagnostics) {
  const body = target?.privateArtifacts?.outreach?.body;
  if (typeof body !== "string") return;
  const optOut = target?.privateArtifacts?.outreach?.optOut;
  const words = countWords(`${body} ${typeof optOut === "string" ? optOut : ""}`);
  if (words < 70 || words > 110) {
    diagnostics.push(
      diagnostic(
        "error",
        "OUTREACH_WORD_COUNT",
        "/privateArtifacts/outreach/body",
        `Outreach body plus opt-out must contain 70–110 words; found ${words}.`,
        { minimum: 70, maximum: 110, actual: words },
      ),
    );
  }
}

function collectClaimStrings(target) {
  const values = [
    ["/site/title", target?.site?.title],
    ["/site/disclosure", target?.site?.disclosure],
    ["/site/cta", target?.site?.cta],
    ["/privateArtifacts/outreach/subject", target?.privateArtifacts?.outreach?.subject],
    ["/privateArtifacts/outreach/body", target?.privateArtifacts?.outreach?.body],
    ["/privateArtifacts/outreach/optOut", target?.privateArtifacts?.outreach?.optOut],
  ];

  for (const [index, signal] of safeArray(target?.signals).entries()) {
    values.push([`/signals/${index}/observation`, signal?.observation]);
  }
  for (const [index, opportunity] of safeArray(target?.opportunities).entries()) {
    values.push([`/opportunities/${index}/hypothesis`, opportunity?.hypothesis]);
    values.push([`/opportunities/${index}/practicalResult`, opportunity?.practicalResult]);
    values.push([`/opportunities/${index}/metric`, opportunity?.metric]);
  }

  return values.filter(([, value]) => typeof value === "string");
}

function addOverclaimDiagnostics(target, mode, diagnostics) {
  if (!new Set(["warning", "error", "off"]).has(mode)) {
    throw new TypeError('validateTarget option overclaimMode must be "warning", "error", or "off".');
  }
  if (mode === "off") return;

  for (const [path, value] of collectClaimStrings(target)) {
    const matched = OVERCLAIM_PATTERNS.find((pattern) => pattern.test(value));
    if (!matched) continue;
    diagnostics.push(
      diagnostic(
        mode,
        "CLAIM_OVERSTATEMENT",
        path,
        "Absolute outcome language requires direct evidence or a falsifiable qualification.",
        { pattern: matched.source },
      ),
    );
  }
}

function isSecurePublicUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function addHttpsDiagnostics(target, diagnostics) {
  const urls = [
    ["/candidate/contact/profileUrl", target?.candidate?.contact?.profileUrl],
  ];
  for (const [index, link] of safeArray(target?.candidate?.proofLinks).entries()) {
    urls.push([`/candidate/proofLinks/${index}/url`, link?.url]);
  }
  for (const [index, source] of safeArray(target?.sources).entries()) {
    urls.push([`/sources/${index}/url`, source?.url]);
  }

  for (const [path, value] of urls) {
    if (typeof value === "string" && !isSecurePublicUrl(value)) {
      diagnostics.push(
        diagnostic(
          "error",
          "URL_HTTPS_REQUIRED",
          path,
          "Public links must be absolute HTTPS URLs without embedded credentials.",
        ),
      );
    }
  }
}

function isValidDomain(value) {
  if (typeof value !== "string" || value.length > 253 || value.endsWith(".")) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[A-Za-z0-9-]+$/.test(label),
    )
  ) {
    return false;
  }
  try {
    return new URL(`https://${value}`).hostname.toLowerCase() === value.toLowerCase();
  } catch {
    return false;
  }
}

function addDomainDiagnostics(target, diagnostics) {
  const domain = target?.company?.domain;
  if (typeof domain === "string" && !isValidDomain(domain)) {
    diagnostics.push(
      diagnostic(
        "error",
        "DOMAIN_INVALID",
        "/company/domain",
        "Company domain must be a bare, valid DNS hostname.",
      ),
    );
  }
}

function isExampleDotComHost(value) {
  if (typeof value !== "string") return false;
  const host = value.toLowerCase().replace(/\.$/, "");
  return host === "example.com" || host.endsWith(".example.com");
}

function addCandidatePlaceholderDiagnostics(target, diagnostics) {
  const name = target?.candidate?.name;
  if (typeof name === "string" && name.trim().toLowerCase() === "candidate name") {
    diagnostics.push(
      diagnostic(
        "warning",
        "CANDIDATE_NAME_PLACEHOLDER",
        "/candidate/name",
        "Replace the Candidate Name placeholder before production rendering.",
      ),
    );
  }

  const bio = target?.candidate?.bio;
  if (typeof bio === "string" && /replace this placeholder/i.test(bio)) {
    diagnostics.push(
      diagnostic(
        "warning",
        "CANDIDATE_BIO_PLACEHOLDER",
        "/candidate/bio",
        "Replace the candidate bio placeholder before production rendering.",
      ),
    );
  }

  const locationTimezone = target?.candidate?.locationTimezone;
  if (typeof locationTimezone === "string" && /^location\b/i.test(locationTimezone.trim())) {
    diagnostics.push(
      diagnostic(
        "warning",
        "CANDIDATE_LOCATION_PLACEHOLDER",
        "/candidate/locationTimezone",
        "Replace the candidate location/timezone placeholder before production rendering.",
      ),
    );
  }

  const profileUrl = target?.candidate?.contact?.profileUrl;
  if (typeof profileUrl === "string") {
    try {
      if (isExampleDotComHost(new URL(profileUrl).hostname)) {
        diagnostics.push(
          diagnostic(
            "warning",
            "CANDIDATE_PROFILE_PLACEHOLDER",
            "/candidate/contact/profileUrl",
            "Replace the example.com candidate profile before production rendering.",
          ),
        );
      }
    } catch {
      // URL diagnostics are emitted separately.
    }
  }

  const email = target?.candidate?.contact?.email;
  if (typeof email === "string") {
    const separator = email.lastIndexOf("@");
    if (separator >= 0 && isExampleDotComHost(email.slice(separator + 1))) {
      diagnostics.push(
        diagnostic(
          "warning",
          "CANDIDATE_EMAIL_PLACEHOLDER",
          "/candidate/contact/email",
          "Replace the example.com candidate email before production rendering, or remove it.",
        ),
      );
    }
  }

  for (const [index, link] of safeArray(target?.candidate?.proofLinks).entries()) {
    let placeholder = typeof link?.label === "string" && /^replace\b/i.test(link.label.trim());
    if (typeof link?.url === "string") {
      try {
        placeholder ||= isExampleDotComHost(new URL(link.url).hostname);
      } catch {
        // URL diagnostics are emitted separately.
      }
    }
    if (placeholder) {
      diagnostics.push(
        diagnostic(
          "warning",
          "CANDIDATE_PROOF_PLACEHOLDER",
          `/candidate/proofLinks/${index}`,
          "Replace the candidate proof-link placeholder before production rendering.",
        ),
      );
    }
  }
}

/**
 * Validate one target document without mutating it.
 *
 * @param {unknown} target untrusted JSON-compatible input
 * @param {{now?: Date|string|number, staleAfterDays?: number, overclaimMode?: "warning"|"error"|"off"}} options
 * @returns {{valid: boolean, diagnostics: Array<object>, errors: Array<object>, warnings: Array<object>, value: unknown}}
 */
export function validateTarget(target, options = {}) {
  const diagnostics = [];
  const schemaValid = validateSchema(target);
  if (!schemaValid) {
    diagnostics.push(...(validateSchema.errors ?? []).map(schemaDiagnostic));
  }

  if (isRecord(target)) {
    addReferenceDiagnostics(target, diagnostics);
    addTargetScoreDiagnostics(target, diagnostics);
    addPolicyDiagnostics(target, diagnostics);
    addPilotDiagnostics(target, diagnostics);
    addDateDiagnostics(target, options, diagnostics);
    addOutreachDiagnostics(target, diagnostics);
    addOverclaimDiagnostics(target, options.overclaimMode ?? "warning", diagnostics);
    addHttpsDiagnostics(target, diagnostics);
    addDomainDiagnostics(target, diagnostics);
    addCandidatePlaceholderDiagnostics(target, diagnostics);
  } else {
    // Validate options even when the document itself is not an object.
    addDateDiagnostics({}, options, diagnostics);
    addOverclaimDiagnostics({}, options.overclaimMode ?? "warning", diagnostics);
  }

  diagnostics.sort(compareDiagnostics);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return {
    valid: errors.length === 0,
    diagnostics,
    errors,
    warnings,
    value: target,
  };
}

export { POLICY_PROFILES };
