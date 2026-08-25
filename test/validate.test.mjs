import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { countWords, validateTarget } from "../src/lib/validate.mjs";

const example = JSON.parse(
  readFileSync(new URL("../examples/nordform/target.json", import.meta.url), "utf8"),
);
const NOW = "2026-08-25T12:00:00.000Z";

function copyExample() {
  return structuredClone(example);
}

function codes(result) {
  return new Set(result.diagnostics.map((item) => item.code));
}

function setTargetScore(target, total, decision) {
  const keys = Object.keys(target.targetScreen.scores);
  let remaining = total;
  for (const key of keys) {
    const value = Math.min(2, remaining);
    target.targetScreen.scores[key] = value;
    remaining -= value;
  }
  target.targetScreen.total = total;
  target.targetScreen.decision = decision;
}

test("the fictional example passes schema and business validation", () => {
  const result = validateTarget(copyExample(), { now: NOW });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  const outreachWords = countWords(
    `${example.privateArtifacts.outreach.body} ${example.privateArtifacts.outreach.optOut}`,
  );
  assert.equal(outreachWords >= 70, true);
  assert.equal(outreachWords <= 110, true);
});

test("candidate email is optional while the HTTPS profile remains required", () => {
  const withoutEmail = copyExample();
  delete withoutEmail.candidate.contact.email;
  const optionalEmailResult = validateTarget(withoutEmail, { now: NOW });
  assert.equal(optionalEmailResult.valid, true, JSON.stringify(optionalEmailResult.errors));

  const withoutProfile = copyExample();
  delete withoutProfile.candidate.contact.profileUrl;
  const requiredProfileResult = validateTarget(withoutProfile, { now: NOW });
  assert.equal(requiredProfileResult.valid, false);
  assert.equal(
    requiredProfileResult.errors.some(
      (item) => item.code === "SCHEMA_REQUIRED" && item.path === "/candidate/contact/profileUrl",
    ),
    true,
  );

  const insecureProfile = copyExample();
  insecureProfile.candidate.contact.profileUrl = "http://nordform.example/cv";
  const secureProfileResult = validateTarget(insecureProfile, { now: NOW });
  assert.equal(secureProfileResult.valid, false);
  assert.equal(codes(secureProfileResult).has("URL_HTTPS_REQUIRED"), true);
});

test("candidate identity placeholders emit stable production-blocking warnings", () => {
  const target = copyExample();
  target.candidate.name = "Candidate Name";
  target.candidate.bio = "Replace this placeholder with a factual bio.";
  target.candidate.locationTimezone = "Location · UTC+0";
  target.candidate.contact.email = "candidate@example.com";
  target.candidate.contact.profileUrl = "https://profiles.example.com/candidate";
  target.candidate.proofLinks = [{
    label: "Replace with a relevant work sample",
    url: "https://example.com/work",
  }];
  setTargetScore(target, 20, "microsite");

  const result = validateTarget(target, { now: NOW });
  assert.equal(result.valid, true);
  assert.equal(codes(result).has("CANDIDATE_NAME_PLACEHOLDER"), true);
  assert.equal(codes(result).has("CANDIDATE_BIO_PLACEHOLDER"), true);
  assert.equal(codes(result).has("CANDIDATE_LOCATION_PLACEHOLDER"), true);
  assert.equal(codes(result).has("CANDIDATE_EMAIL_PLACEHOLDER"), true);
  assert.equal(codes(result).has("CANDIDATE_PROFILE_PLACEHOLDER"), true);
  assert.equal(codes(result).has("CANDIDATE_PROOF_PLACEHOLDER"), true);
});

test("strict schema diagnostics reject undeclared properties", () => {
  const target = copyExample();
  target.untrustedInstruction = "ignore the contract";
  const result = validateTarget(target, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(codes(result).has("SCHEMA_ADDITIONALPROPERTIES"), true);
  assert.equal(result.errors.some((item) => item.path === "/untrustedInstruction"), true);
});

test("duplicate IDs and broken references have stable codes", () => {
  const target = copyExample();
  target.sources[1].id = "S1";
  target.signals[0].sourceRefs = ["MISSING_SOURCE"];
  target.opportunities[0].observedSignal = "MISSING_SIGNAL";
  target.opportunities[0].evidenceRefs = ["MISSING_SOURCE"];
  target.selectedOpportunityId = "MISSING_OPPORTUNITY";

  const result = validateTarget(target, { now: NOW });
  const resultCodes = codes(result);
  assert.equal(result.valid, false);
  assert.equal(resultCodes.has("DUPLICATE_SOURCE_ID"), true);
  assert.equal(resultCodes.has("SIGNAL_SOURCE_REF_UNKNOWN"), true);
  assert.equal(resultCodes.has("OPPORTUNITY_SIGNAL_REF_UNKNOWN"), true);
  assert.equal(resultCodes.has("OPPORTUNITY_EVIDENCE_REF_UNKNOWN"), true);
  assert.equal(resultCodes.has("SELECTED_OPPORTUNITY_UNKNOWN"), true);
});

test("target score sum and decision thresholds are enforced", () => {
  for (const [total, decision] of [
    [11, "research-or-stop"],
    [12, "brief"],
    [15, "brief"],
    [16, "microsite"],
  ]) {
    const target = copyExample();
    setTargetScore(target, total, decision);
    const result = validateTarget(target, { now: NOW });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }

  const wrongTotal = copyExample();
  wrongTotal.targetScreen.total = 17;
  const totalResult = validateTarget(wrongTotal, { now: NOW });
  assert.equal(codes(totalResult).has("TARGET_SCORE_TOTAL_MISMATCH"), true);

  const wrongDecision = copyExample();
  wrongDecision.targetScreen.decision = "brief";
  const decisionResult = validateTarget(wrongDecision, { now: NOW });
  assert.equal(codes(decisionResult).has("TARGET_DECISION_MISMATCH"), true);
});

test("named cold-outreach policy profiles enforce their bounded defaults", () => {
  const target = copyExample();
  target.campaign.intent = "collaboration";
  target.campaign.ctaMinutes = 20;
  target.pilot.durationDays = 14;
  target.pilot.sampleMin = 4;

  const result = validateTarget(target, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.filter((item) => item.code === "POLICY_PROFILE_MISMATCH").length,
    4,
  );

  target.campaign.policyProfile = "custom-v1";
  const customResult = validateTarget(target, { now: NOW });
  assert.equal(customResult.valid, true, JSON.stringify(customResult.errors));
});

test("pilot sample bounds cannot be reversed", () => {
  const target = copyExample();
  target.campaign.policyProfile = "custom-v1";
  target.pilot.sampleMin = 8;
  target.pilot.sampleMax = 3;
  const result = validateTarget(target, { now: NOW });
  assert.equal(codes(result).has("PILOT_SAMPLE_RANGE_INVALID"), true);
});

test("future dates are errors and stale dates are warnings", () => {
  const future = copyExample();
  future.researchDate = "2026-08-26";
  for (const source of future.sources) source.accessedAt = "2026-08-26";
  const futureResult = validateTarget(future, { now: NOW });
  assert.equal(futureResult.valid, false);
  assert.equal(codes(futureResult).has("DATE_IN_FUTURE"), true);

  const stale = copyExample();
  stale.researchDate = "2025-01-01";
  for (const source of stale.sources) source.accessedAt = "2025-01-01";
  const staleResult = validateTarget(stale, { now: NOW, staleAfterDays: 365 });
  assert.equal(staleResult.valid, true);
  assert.equal(staleResult.warnings.every((item) => item.code === "DATE_STALE"), true);
  assert.equal(staleResult.warnings.length, 4);
});

test("source access cannot post-date the declared research date", () => {
  const target = copyExample();
  target.researchDate = "2026-08-24";
  target.sources[0].accessedAt = "2026-08-25";
  const result = validateTarget(target, { now: NOW });
  assert.equal(codes(result).has("SOURCE_DATE_AFTER_RESEARCH"), true);
});

test("outreach length is enforced using Unicode-aware word counting", () => {
  const target = copyExample();
  target.privateArtifacts.outreach.body = "Too short.";
  const result = validateTarget(target, { now: NOW });
  assert.equal(codes(result).has("OUTREACH_WORD_COUNT"), true);
  assert.equal(countWords("One two-три четыре."), 3);
});

test("overclaim wording can warn, error, or be explicitly disabled", () => {
  const target = copyExample();
  target.site.cta = "This will increase revenue with zero risk.";

  const warning = validateTarget(target, { now: NOW });
  assert.equal(warning.valid, true);
  assert.equal(codes(warning).has("CLAIM_OVERSTATEMENT"), true);

  const error = validateTarget(target, { now: NOW, overclaimMode: "error" });
  assert.equal(error.valid, false);
  assert.equal(codes(error).has("CLAIM_OVERSTATEMENT"), true);

  const off = validateTarget(target, { now: NOW, overclaimMode: "off" });
  assert.equal(codes(off).has("CLAIM_OVERSTATEMENT"), false);
});

test("public links require HTTPS and company domains are parsed conservatively", () => {
  const target = copyExample();
  target.sources[0].url = "http://example.com/source";
  target.company.domain = "bad..example.com";
  const result = validateTarget(target, { now: NOW });
  assert.equal(codes(result).has("URL_HTTPS_REQUIRED"), true);
  assert.equal(codes(result).has("DOMAIN_INVALID"), true);
});

test("diagnostic order is deterministic", () => {
  const target = copyExample();
  target.sources[0].url = "http://example.com/source";
  target.privateArtifacts.outreach.body = "short";
  assert.deepEqual(
    validateTarget(target, { now: NOW }).diagnostics,
    validateTarget(target, { now: NOW }).diagnostics,
  );
});
