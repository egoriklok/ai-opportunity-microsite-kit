import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { renderTarget } from "../src/lib/render.mjs";

const PRIVATE_BODY = "PRIVATE-OUTREACH-BODY-7ecb";
const PRIVATE_ROLE = "PRIVATE-RECIPIENT-ROLE-8fc1";
const PRIVATE_SCREEN_VALUE = 17;

function targetFixture() {
  return {
    schemaVersion: "1.0.0",
    researchDate: "2026-08-25",
    campaign: {
      policyProfile: "employment-cold-v1",
      intent: "employment",
      targetRole: "AI operator",
      locales: ["en"],
      ctaMinutes: 15,
      noindex: true,
    },
    candidate: {
      name: "Sam <script>alert('candidate')</script>",
      role: "AI workflow operator",
      bio: "Evidence & delivery",
      locationTimezone: "UTC+0",
      contact: { email: "sam+work@example.com", profileUrl: "https://example.com/profile" },
      proofLinks: [{ label: "Proof <strong>one</strong>", url: "https://example.com/proof" }],
    },
    company: {
      name: "Acme Machines",
      domain: "example.com",
      industry: "industrial machinery",
      geography: "example market",
      recipientRole: PRIVATE_ROLE,
    },
    targetScreen: {
      scores: { privateScore: PRIVATE_SCREEN_VALUE },
      total: PRIVATE_SCREEN_VALUE,
      decision: "microsite",
    },
    sources: [
      {
        id: "S1",
        type: "official-site",
        title: "Catalogue <img src=x onerror=alert(1)>",
        url: "https://example.com/catalogue?x=1&y=2",
        accessedAt: "2026-08-25",
        supports: "A visible & sourced workflow.",
      },
    ],
    signals: [
      {
        id: "G1",
        observation: "Public evidence <svg onload=alert(1)>",
        status: "fact",
        sourceRefs: ["S1"],
      },
    ],
    opportunities: [
      {
        id: "O1",
        title: "Qualification brief",
        hypothesis: "A bounded preparation step may help.",
        status: "inference",
        whyItMayBeWrong: "The current process may already work.",
        missingEvidence: ["Current baseline"],
        aiPrepares: ["A review brief"],
        humanDecides: "An engineer approves every commitment.",
        practicalResult: "A consistent brief.",
        metric: "Median preparation time.",
        stopRule: "Stop if quality falls.",
        evidenceRefs: ["S1"],
      },
    ],
    selectedOpportunityId: "O1",
    pilot: {
      durationDays: 30,
      sampleMin: 3,
      sampleMax: 5,
      steps: ["Record baseline", "Test examples", "Review", "Decide"],
      decision: ["KEEP", "CHANGE", "STOP"],
    },
    site: {
      title: "A <testable> hypothesis",
      disclosure: "Independent work sample.",
      cta: "Would 15 minutes be useful?",
      unknowns: ["Internal baseline"],
      artifact: {
        title: "Request card",
        label: "Illustrative only",
        fields: [{ name: "Material", value: "Unknown <script>bad()</script>" }],
      },
    },
    privateArtifacts: {
      outreach: {
        subject: "Private draft",
        body: PRIVATE_BODY,
        optOut: "Reply no and there will be no follow-up.",
      },
    },
  };
}

async function tempCase(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aomk-render-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("renders deterministic public and private trees without crossing the boundary", async (t) => {
  const root = await tempCase(t);
  const outDir = path.join(root, "output");
  const target = targetFixture();

  const first = await renderTarget(target, { outDir });
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
  assert.match(html, /href="mailto:sam%2Bwork%40example.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /https?:\/\/(?:fonts|cdn|analytics|www\.googletagmanager)\./i);

  const snapshot = new Map(
    await Promise.all(
      first.files.map(async (file) => [file, await readFile(path.join(outDir, file), "utf8")]),
    ),
  );
  await renderTarget(target, { outDir, force: true });
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
    renderTarget(unsafeUrl, { outDir: path.join(root, "unsafe-url") }),
    (error) => error.code === "AOMK_UNSAFE_URL",
  );

  const httpUrl = targetFixture();
  httpUrl.candidate.proofLinks[0].url = "http://example.com/proof";
  await assert.rejects(
    renderTarget(httpUrl, { outDir: path.join(root, "http-url") }),
    (error) => error.code === "AOMK_UNSAFE_URL",
  );

  const unsafeEmail = targetFixture();
  unsafeEmail.candidate.contact.email = "sam@example.com?subject=injected";
  await assert.rejects(
    renderTarget(unsafeEmail, { outDir: path.join(root, "unsafe-email") }),
    (error) => error.code === "AOMK_UNSAFE_EMAIL",
  );
});

test("refuses overwrite unless a force marker matches the product and slug", async (t) => {
  const root = await tempCase(t);
  const outDir = path.join(root, "output");
  const target = targetFixture();
  await renderTarget(target, { outDir });

  await assert.rejects(
    renderTarget(target, { outDir }),
    (error) => error.code === "AOMK_OUTPUT_EXISTS",
  );

  const markerPath = path.join(outDir, ".aomk-output.json");
  await writeFile(
    markerPath,
    `${JSON.stringify({ product: "another-product", outputVersion: 1, slug: "acme-machines" })}\n`,
  );
  await assert.rejects(
    renderTarget(target, { outDir, force: true }),
    (error) => error.code === "AOMK_MARKER_MISMATCH",
  );
});

test("rejects traversal-like slugs and filesystem roots", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();

  await assert.rejects(
    renderTarget(target, { outDir: path.join(root, "output"), slug: "../escape" }),
    (error) => error.code === "AOMK_UNSAFE_SLUG",
  );
  await assert.rejects(
    renderTarget(target, { outDir: path.parse(root).root }),
    (error) => error.code === "AOMK_UNSAFE_OUTPUT",
  );
});

test("requires microsite readiness unless preview is explicit and visible", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  target.targetScreen.decision = "brief";
  target.targetScreen.total = 12;

  await assert.rejects(
    renderTarget(target, { outDir: path.join(root, "blocked") }),
    (error) => error.code === "AOMK_TARGET_NOT_READY",
  );

  await renderTarget(target, { outDir: path.join(root, "preview"), preview: true });
  const html = await readFile(path.join(root, "preview", "public", "index.html"), "utf8");
  assert.match(html, /PREVIEW — this target is not approved for publication/);
});

test("keeps untrusted draft syntax in plain-text review artifacts", async (t) => {
  const root = await tempCase(t);
  const target = targetFixture();
  target.company.recipientRole = "Director <img src=x onerror=alert(1)>";
  target.privateArtifacts.outreach.body = "Hello ![probe](https://attacker.example/pixel) <script>alert(1)</script>";
  await renderTarget(target, { outDir: path.join(root, "output") });

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
    renderTarget(target, { outDir: path.join(root, "blocked"), validation }),
    (error) => error.code === "AOMK_VALIDATION_BLOCKED",
  );
  await renderTarget(target, {
    outDir: path.join(root, "preview"),
    validation,
    preview: true,
  });
  const qa = await readFile(path.join(root, "preview", "private", "qa-report.json"), "utf8");
  assert.match(qa, /"code": "DATE_STALE"/);
  assert.match(qa, /"renderMode": "preview"/);
});
