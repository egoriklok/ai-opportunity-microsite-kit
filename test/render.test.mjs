import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { renderTarget } from "../src/lib/render.mjs";
import { validateTarget } from "../src/lib/validate.mjs";

const PRIVATE_BODY = "PRIVATE-OUTREACH-BODY-7ecb";
const PRIVATE_ROLE = "PRIVATE-RECIPIENT-ROLE-8fc1";
const PRIVATE_SCREEN_VALUE = 17;
const RENDER_NOW = "2026-08-25T12:00:00.000Z";
const BASE_TARGET = JSON.parse(
  readFileSync(new URL("../examples/nordform/target.json", import.meta.url), "utf8"),
);

function targetFixture() {
  const target = structuredClone(BASE_TARGET);
  target.campaign.targetRole = "AI operator";
  target.candidate = {
    name: "Sam <script>alert('candidate')</script>",
    role: "AI workflow operator",
    bio: "Evidence & delivery",
    locationTimezone: "UTC+0",
    contact: {
      email: "sam+work@candidate.test",
      profileUrl: "https://candidate.test/profile",
    },
    proofLinks: [{ label: "Proof <strong>one</strong>", url: "https://candidate.test/proof" }],
  };
  target.company = {
    name: "Acme Machines",
    domain: "acme-machines.test",
    industry: "industrial machinery",
    geography: "example market",
    recipientRole: PRIVATE_ROLE,
  };
  target.targetScreen = {
    scores: {
      recentTrigger: 2,
      visibleWorkflow: 2,
      measurableEffect: 2,
      qualitySources: 2,
      humanOwnedMechanism: 2,
      publicArtifact: 2,
      candidateFit: 2,
      recipientRole: 1,
      manageableRisk: 1,
      companySpecificity: 1,
    },
    total: PRIVATE_SCREEN_VALUE,
    decision: "microsite",
  };
  Object.assign(target.sources[0], {
    title: "Catalogue <img src=x onerror=alert(1)>",
    url: "https://acme-machines.test/catalogue?x=1&y=2",
    supports: "A visible & sourced workflow.",
  });
  target.signals[0].observation = "Public evidence <svg onload=alert(1)>";
  Object.assign(target.opportunities[0], {
    title: "Qualification brief",
    hypothesis: "A bounded preparation step may help.",
    whyItMayBeWrong: "The current process may already work.",
    missingEvidence: ["Current baseline"],
    aiPrepares: ["A review brief"],
    humanDecides: "An engineer approves every commitment.",
    practicalResult: "A consistent brief.",
    metric: "Median preparation time.",
    stopRule: "Stop if quality falls.",
  });
  Object.assign(target.site, {
    title: "A <testable> hypothesis",
    disclosure: "Independent work sample.",
    cta: "Would 15 minutes be useful?",
    unknowns: ["Internal baseline"],
    artifact: {
      title: "Request card",
      label: "Illustrative only",
      fields: [
        { name: "Material", value: "Unknown <script>bad()</script>" },
        { name: "Tolerance", value: "Human review required" },
      ],
    },
  });
  target.privateArtifacts.outreach = {
    subject: "Private draft",
    body: `Hello Decision Owner,\n\n${PRIVATE_BODY} is an inert review marker inside this evidence-led draft. The public sources suggest a visible preparation workflow, but they do not establish internal pain, volume, or impact. I would first verify the current baseline, decision owner, and quality constraints using anonymized examples only before proposing any bounded test. Would 15 minutes be useful for that reality check?\n\nSam`,
    optOut: "Reply no and there will be no follow-up.",
  };
  return target;
}

async function tempCase(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aomk-render-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function renderFixture(target, options) {
  return renderTarget(target, { ...options, now: RENDER_NOW });
}

test("renders deterministic public and private trees without crossing the boundary", async (t) => {
  const root = await tempCase(t);
  const outDir = path.join(root, "output");
  const target = targetFixture();
  const validation = validateTarget(target);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.deepEqual(validation.warnings, []);

  const first = await renderFixture(target, { outDir });
  const html = await readFile(path.join(outDir, "public", "index.html"), "utf8");
  const outreach = await readFile(path.join(outDir, "private", "outreach.txt"), "utf8");
  const callBrief = await readFile(path.join(outDir, "private", "call-brief.txt"), "utf8");
  const qa = await readFile(path.join(outDir, "private", "qa-report.json"), "utf8");
  const robots = await readFile(path.join(outDir, "public", "robots.txt"), "utf8");
  const marker = await readFile(path.join(outDir, ".aomk-output.json"), "utf8");

  assert.equal(first.slug, "acme-machines");
  assert.deepEqual(first.files, [
    "public/index.html",
    "public/robots.txt",
    "private/outreach.txt",
    "private/call-brief.txt",
    "private/qa-report.json",
    ".aomk-output.json",
  ]);
  assert.equal(robots, "User-agent: *\nDisallow: /\n");
  assert.match(outreach, new RegExp(PRIVATE_BODY));
  assert.match(callBrief, new RegExp(PRIVATE_ROLE));
  assert.match(qa, new RegExp(`\"total\": ${PRIVATE_SCREEN_VALUE}`));

  assert.doesNotMatch(html, new RegExp(PRIVATE_BODY));
  assert.doesNotMatch(html, new RegExp(PRIVATE_ROLE));
  assert.doesNotMatch(html, /targetScreen|privateArtifacts|privateScore/);
  assert.doesNotMatch(html, /<script[ >]|<svg[ >]|<img[ >]/i);
  assert.match(html, /Sam &lt;script&gt;alert\(&#39;candidate&#39;\)&lt;\/script&gt;/);
  assert.match(html, /Catalogue &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Unknown &lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /href="mailto:sam%2Bwork%40candidate.test"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /https?:\/\/(?:fonts|cdn|analytics|www\.googletagmanager)\./i);

  const snapshot = new Map(
    await Promise.all(
      first.files.map(async (file) => [file, await readFile(path.join(outDir, file), "utf8")]),
    ),
  );
  await renderFixture(target, { outDir, force: true });
  for (const [file, content] of snapshot) {
    assert.equal(await readFile(path.join(outDir, file), "utf8"), content, `${file} changed`);
  }
  assert.equal(await readFile(path.join(outDir, ".aomk-output.json"), "utf8"), marker);
});

test("rejects unsafe public URLs and mailboxes instead of silently publishing them", async (t) => {
  const root = await tempCase(t);
  const unsafeUrl = targetFixture();
  unsafeUrl.sources[0].url = "javascript:alert(1)";
  await assert.rejects(
    renderFixture(unsafeUrl, { outDir: path.join(root, "unsafe-url") }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );

  const httpUrl = targetFixture();
  httpUrl.candidate.proofLinks[0].url = "http://example.com/proof";
  await assert.rejects(
    renderFixture(httpUrl, { outDir: path.join(root, "http-url") }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );

  const unsafeEmail = targetFixture();
  unsafeEmail.candidate.contact.email = "sam@example.com?subject=injected";
  await assert.rejects(
    renderFixture(unsafeEmail, { outDir: path.join(root, "unsafe-email") }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );
});

test("uses the required profile as the CTA when candidate email is absent", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  delete target.candidate.contact.email;

  await renderFixture(target, { outDir: path.join(root, "profile-cta") });
  const html = await readFile(path.join(root, "profile-cta", "public", "index.html"), "utf8");
  assert.match(
    html,
    /href="https:\/\/candidate\.test\/profile" rel="noopener noreferrer">Contact Sam &lt;script&gt;alert\(&#39;candidate&#39;\)&lt;\/script&gt; via profile<\/a>/,
  );
  assert.doesNotMatch(html, /mailto:/);
});

test("refuses overwrite unless a force marker matches the product and slug", async (t) => {
  const root = await tempCase(t);
  const outDir = path.join(root, "output");
  const target = targetFixture();
  await renderFixture(target, { outDir });

  await assert.rejects(
    renderFixture(target, { outDir }),
    (error) => error.code === "AOMK_OUTPUT_EXISTS",
  );

  const markerPath = path.join(outDir, ".aomk-output.json");
  await writeFile(
    markerPath,
    `${JSON.stringify({ product: "another-product", outputVersion: 1, slug: "acme-machines" })}\n`,
  );
  await assert.rejects(
    renderFixture(target, { outDir, force: true }),
    (error) => error.code === "AOMK_MARKER_MISMATCH",
  );
});

test("rejects traversal-like slugs and filesystem roots", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();

  await assert.rejects(
    renderFixture(target, { outDir: path.join(root, "output"), slug: "../escape" }),
    (error) => error.code === "AOMK_UNSAFE_SLUG",
  );
  await assert.rejects(
    renderFixture(target, { outDir: path.parse(root).root }),
    (error) => error.code === "AOMK_UNSAFE_OUTPUT",
  );
});

test("requires microsite readiness unless preview is explicit and visible", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  for (const key of Object.keys(target.targetScreen.scores)) {
    target.targetScreen.scores[key] = 1;
  }
  target.targetScreen.scores.recentTrigger = 2;
  target.targetScreen.scores.visibleWorkflow = 2;
  target.targetScreen.decision = "brief";
  target.targetScreen.total = 12;

  await assert.rejects(
    renderFixture(target, { outDir: path.join(root, "blocked") }),
    (error) => error.code === "AOMK_TARGET_NOT_READY",
  );

  await renderFixture(target, { outDir: path.join(root, "preview"), preview: true });
  const html = await readFile(path.join(root, "preview", "public", "index.html"), "utf8");
  assert.match(html, /PREVIEW — this target is not approved for publication/);
});

test("keeps untrusted draft syntax in plain-text review artifacts", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  target.company.recipientRole = "Director <img src=x onerror=alert(1)>";
  target.privateArtifacts.outreach.body = "Hello Director <img src=x onerror=alert(1)>, ![probe](https://attacker.example/pixel) <script>alert(1)</script> remains inert plain text in this review-only draft. This is a formatting safety test; no message will be sent and no remote resource should be loaded. Public evidence suggests a visible workflow, but it does not prove an internal problem, baseline, volume, authority, or impact. I would verify the owner, current process, quality constraints, representative examples, and stop rule before proposing any bounded test. Would 15 minutes be useful for that check?";
  await renderFixture(target, { outDir: path.join(root, "output") });

  const outreach = await readFile(path.join(root, "output", "private", "outreach.txt"), "utf8");
  const brief = await readFile(path.join(root, "output", "private", "call-brief.txt"), "utf8");
  assert.match(outreach, /!\[probe\]\(https:\/\/attacker\.example\/pixel\)/);
  assert.match(brief, /<img src=x onerror=alert\(1\)>/);
  await assert.rejects(
    access(path.join(root, "output", "private", "outreach.md")),
    (error) => error.code === "ENOENT",
  );
});

test("validated warnings require preview and are recorded in private QA", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  const warning = {
    severity: "warning",
    code: "DATE_STALE",
    path: "/researchDate",
    message: "Refresh.",
  };
  const validation = {
    valid: true,
    errors: [],
    warnings: [warning],
    diagnostics: [warning],
  };
  await assert.rejects(
    renderFixture(target, { outDir: path.join(root, "blocked"), validation }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );
  await renderFixture(target, {
    outDir: path.join(root, "preview"),
    validation,
    preview: true,
  });
  const qa = await readFile(path.join(root, "preview", "private", "qa-report.json"), "utf8");
  assert.match(qa, /"code": "DATE_STALE"/);
  assert.match(qa, /"renderMode": "preview"/);
});

test("intrinsic validation cannot be bypassed by omitting or forging validation", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  target.candidate.bio = "Replace this placeholder with a concise bio.";
  const forgedValidation = { valid: true, errors: [], warnings: [], diagnostics: [] };

  await assert.rejects(
    renderFixture(target, {
      outDir: path.join(root, "blocked-without-validation"),
    }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );
  await assert.rejects(
    renderFixture(target, {
      outDir: path.join(root, "blocked-forged-validation"),
      validation: forgedValidation,
    }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );
  await assert.rejects(access(path.join(root, "blocked-forged-validation")));

  await renderFixture(target, {
    outDir: path.join(root, "preview"),
    validation: forgedValidation,
    preview: true,
  });
  const qa = await readFile(path.join(root, "preview", "private", "qa-report.json"), "utf8");
  assert.match(qa, /"code": "CANDIDATE_BIO_PLACEHOLDER"/);
});
