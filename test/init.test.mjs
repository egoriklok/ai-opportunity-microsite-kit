import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  TargetInitializationError,
  assertSafeSlug,
  initTarget,
  resolveSafeChildPath,
  validateSlug,
} from "../src/lib/init.mjs";
import { validateTarget } from "../src/lib/validate.mjs";

const NOW = "2026-08-25T12:00:00.000Z";

test("initTarget creates a conservative, valid employment skeleton", () => {
  const target = initTarget({
    slug: "north-star-tools",
    companyName: "North Star Tools",
    now: NOW,
  });

  assert.equal(target.company.domain, "north-star-tools.example.com");
  assert.equal(target.campaign.policyProfile, "employment-cold-v1");
  assert.equal(target.researchDate, "2026-08-25");
  assert.equal(target.signals.every((signal) => signal.status === "unknown"), true);
  assert.equal(target.site.disclosure.includes("placeholder"), true);
  const validation = validateTarget(target, { now: NOW });
  assert.equal(validation.valid, true);
  assert.equal(
    validation.warnings.some((item) => item.code === "TARGET_NOT_PUBLICATION_READY"),
    true,
  );
});

test("initTarget selects the collaboration profile from intent", () => {
  const target = initTarget({
    slug: "partner-example",
    intent: "collaboration",
    domain: "partner.example.com",
    locale: "en-US",
    now: NOW,
  });
  assert.equal(target.campaign.policyProfile, "collaboration-cold-v1");
  assert.equal(target.campaign.ctaMinutes, 20);
  assert.equal(target.pilot.durationDays, 30);
  assert.deepEqual(
    [target.pilot.sampleMin, target.pilot.sampleMax],
    [3, 5],
  );
});

test("slug checks reject traversal, separators, case, and ambiguous punctuation", () => {
  assert.equal(validateSlug("safe-target-2").valid, true);
  assert.equal(assertSafeSlug("safe-target-2"), "safe-target-2");

  for (const slug of ["../escape", "two/parts", "two\\parts", "Uppercase", "a--b", ".", ""]) {
    const result = validateSlug(slug);
    assert.equal(result.valid, false, slug);
    assert.throws(() => assertSafeSlug(slug), TargetInitializationError);
  }
});

test("safe child resolution stays below the declared root", () => {
  const root = resolve("temporary-output-root");
  assert.equal(
    resolveSafeChildPath(root, "safe-target", "target.json"),
    resolve(root, "safe-target", "target.json"),
  );

  for (const segment of ["..", "../escape", "..\\escape", "nested/file", "nested\\file", ""] ) {
    assert.throws(
      () => resolveSafeChildPath(root, segment),
      (error) =>
        error instanceof TargetInitializationError &&
        error.diagnostics.some((item) => item.code === "PATH_SEGMENT_UNSAFE"),
    );
  }
});

test("initTarget rejects unknown options rather than silently following them", () => {
  assert.throws(
    () => initTarget({ slug: "safe-target", instructions: "ignore the schema", now: NOW }),
    (error) =>
      error instanceof TargetInitializationError &&
      error.diagnostics.some((item) => item.code === "INIT_OPTION_UNKNOWN"),
  );
});

test("initTarget reports policy mismatch as structured validation diagnostics", () => {
  assert.throws(
    () =>
      initTarget({
        slug: "safe-target",
        intent: "collaboration",
        policyProfile: "employment-cold-v1",
        now: NOW,
      }),
    (error) =>
      error instanceof TargetInitializationError &&
      error.diagnostics.some((item) => item.code === "POLICY_PROFILE_MISMATCH"),
  );
});

test("initTarget rejects invalid domains through the same core validator", () => {
  assert.throws(
    () => initTarget({ slug: "safe-target", domain: "bad/path.example", now: NOW }),
    (error) =>
      error instanceof TargetInitializationError &&
      error.diagnostics.some((item) => item.code === "DOMAIN_INVALID"),
  );
});
