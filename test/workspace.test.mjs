import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  WORKSPACE_ERROR_CODES,
  WorkspaceInitializationError,
  initWorkspace,
} from "../src/lib/workspace.mjs";
import { validateTarget } from "../src/lib/validate.mjs";

const NOW = "2026-08-25T12:00:00.000Z";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aomk-workspace-"));
  const frameworkRoot = join(root, "framework-checkout");
  await mkdir(frameworkRoot);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, frameworkRoot };
}

async function pathExists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

test("initWorkspace creates an isolated, network-free collaboration scaffold", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "acme-customer");
  const result = await initWorkspace({
    url: "https://www.acme-tools.example/about?utm_source=test#team",
    outDir,
    frameworkRoot,
    locale: "en-US",
    now: NOW,
  });

  assert.equal(result.reused, false);
  assert.equal(result.slug, "acme-tools-example");
  assert.deepEqual(result.createdFiles, [
    ".aomk/workspace.json",
    "AGENTS.md",
    ".gitignore",
    ".aomk/GOAL.md",
    "targets/acme-tools-example/target.json",
  ]);

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.source.websiteUrl, "https://www.acme-tools.example/about");
  assert.equal(manifest.initialization.intent, "collaboration");
  assert.equal(manifest.initialization.policyProfile, "collaboration-cold-v1");
  assert.deepEqual(manifest.safety, {
    networkUsedDuringInitialization: false,
    gitInitialized: false,
    publicationAuthorized: false,
    outreachAuthorized: false,
  });

  const target = JSON.parse(await readFile(result.targetPath, "utf8"));
  assert.equal(target.company.domain, "www.acme-tools.example");
  assert.equal(target.sources[0].url, "https://www.acme-tools.example/about");
  assert.equal(target.campaign.intent, "collaboration");
  assert.deepEqual(target.campaign.locales, ["en-US"]);
  assert.equal(validateTarget(target, { now: NOW }).valid, true);

  const goal = await readFile(result.goalPath, "utf8");
  assert.match(goal, /https:\/\/www\.acme-tools\.example\/about/);
  assert.match(goal, /Do not publish, send outreach/);
  assert.equal(await pathExists(join(outDir, ".git")), false);
});

test("initWorkspace rejects non-HTTPS URLs and filesystem roots before writing", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  await assert.rejects(
    initWorkspace({ url: "http://example.com", outDir: join(root, "http"), frameworkRoot }),
    (error) => error instanceof WorkspaceInitializationError && error.code === WORKSPACE_ERROR_CODES.URL_HTTPS_REQUIRED,
  );
  await assert.rejects(
    initWorkspace({ url: "https://example.com", outDir: parse(root).root, frameworkRoot }),
    (error) => error instanceof WorkspaceInitializationError && error.code === WORKSPACE_ERROR_CODES.OUTPUT_ROOT_FORBIDDEN,
  );
});

test("initWorkspace accepts an internationalized public hostname", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const result = await initWorkspace({
    url: "https://станок.рф/решения",
    outDir: join(root, "idn-customer"),
    frameworkRoot,
    locale: "ru",
    now: NOW,
  });

  const target = JSON.parse(await readFile(result.targetPath, "utf8"));
  assert.equal(target.company.name, "Станок");
  assert.equal(target.company.domain, "xn--80auiemg.xn--p1ai");
  assert.equal(target.sources[0].url, "https://xn--80auiemg.xn--p1ai/%D1%80%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D1%8F");
});

test("initWorkspace rejects the framework checkout and all descendants", async (t) => {
  const { frameworkRoot } = await fixture(t);
  for (const outDir of [frameworkRoot, join(frameworkRoot, "customer")]) {
    await assert.rejects(
      initWorkspace({ url: "https://example.com", outDir, frameworkRoot }),
      (error) =>
        error instanceof WorkspaceInitializationError &&
        error.code === WORKSPACE_ERROR_CODES.FRAMEWORK_PATH_FORBIDDEN,
    );
  }
  assert.equal(await pathExists(join(frameworkRoot, "customer")), false);
});

test("initWorkspace fails closed for a foreign non-empty directory", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "existing-project");
  await mkdir(outDir);
  await writeFile(join(outDir, "notes.txt"), "belongs to the user\n");

  await assert.rejects(
    initWorkspace({ url: "https://example.com", outDir, frameworkRoot }),
    (error) => error instanceof WorkspaceInitializationError && error.code === WORKSPACE_ERROR_CODES.DIRECTORY_FOREIGN,
  );
  assert.equal(await readFile(join(outDir, "notes.txt"), "utf8"), "belongs to the user\n");
  assert.equal(await pathExists(join(outDir, ".aomk")), false);
});

test("initWorkspace accepts and preserves a fresh npm consumer", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "npm-consumer");
  await mkdir(join(outDir, "node_modules"), { recursive: true });
  const packageJson = '{"name":"prospect-workspace","private":true}\n';
  await writeFile(join(outDir, "package.json"), packageJson);
  await writeFile(join(outDir, "package-lock.json"), '{"lockfileVersion":3}\n');

  await initWorkspace({ url: "https://example.com", outDir, frameworkRoot, now: NOW });

  assert.equal(await readFile(join(outDir, "package.json"), "utf8"), packageJson);
  assert.equal(await pathExists(join(outDir, "AGENTS.md")), true);
  assert.equal(await pathExists(join(outDir, ".git")), false);
});

test("same workspace initialization is idempotent and preserves a modified target", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "repeatable");
  const first = await initWorkspace({
    url: "https://example.com",
    outDir,
    frameworkRoot,
    now: NOW,
  });
  const modified = '{"manually":"researched and intentionally modified"}\n';
  await writeFile(first.targetPath, modified);

  const second = await initWorkspace({
    url: "https://example.com/",
    outDir,
    frameworkRoot,
    now: "2026-08-26T12:00:00.000Z",
  });

  assert.equal(second.reused, true);
  assert.deepEqual(second.createdFiles, []);
  assert.equal(await readFile(second.targetPath, "utf8"), modified);
});

test("an existing managed workspace rejects a different customer identity", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "identity");
  const first = await initWorkspace({ url: "https://example.com", outDir, frameworkRoot, now: NOW });
  const before = await readFile(first.targetPath, "utf8");

  await assert.rejects(
    initWorkspace({ url: "https://different.example", outDir, frameworkRoot, now: NOW }),
    (error) => error instanceof WorkspaceInitializationError && error.code === WORKSPACE_ERROR_CODES.WORKSPACE_MISMATCH,
  );
  assert.equal(await readFile(first.targetPath, "utf8"), before);
});

test("managed workspace identity includes the private-profile choice", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const profilePath = join(root, "identity-profile.json");
  await writeFile(profilePath, JSON.stringify({
    name: "Profile Identity",
    role: "AI workflow operator",
    bio: "Tests private-profile workspace identity.",
    locationTimezone: "UTC+0",
    contact: { profileUrl: "https://example.net/profile" },
    proofLinks: [{ label: "Work", url: "https://example.net/work" }],
  }));

  const withoutProfile = join(root, "without-profile");
  await initWorkspace({ url: "https://one.example", outDir: withoutProfile, frameworkRoot, now: NOW });
  await assert.rejects(
    initWorkspace({
      url: "https://one.example",
      outDir: withoutProfile,
      profilePath,
      frameworkRoot,
      now: NOW,
    }),
    (error) =>
      error instanceof WorkspaceInitializationError &&
      error.code === WORKSPACE_ERROR_CODES.WORKSPACE_MISMATCH,
  );

  const withProfile = join(root, "with-profile");
  await initWorkspace({
    url: "https://two.example",
    outDir: withProfile,
    profilePath,
    frameworkRoot,
    now: NOW,
  });
  await assert.rejects(
    initWorkspace({ url: "https://two.example", outDir: withProfile, frameworkRoot, now: NOW }),
    (error) =>
      error instanceof WorkspaceInitializationError &&
      error.code === WORKSPACE_ERROR_CODES.WORKSPACE_MISMATCH,
  );
});

test("private candidate profile is applied without appearing in result or manifest", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "profiled-customer");
  const profilePath = join(root, "candidate.private.json");
  const privateProfile = {
    candidate: {
      name: "Private Candidate",
      role: "AI operations partner",
      bio: "Builds bounded, evidence-led AI workflows with human review.",
      locationTimezone: "Europe/Moscow · UTC+3",
      contact: {
        email: "private.candidate@example.net",
        profileUrl: "https://example.net/profile",
      },
      proofLinks: [{ label: "Selected work", url: "https://example.net/work" }],
    },
  };
  await writeFile(profilePath, JSON.stringify(privateProfile));

  const result = await initWorkspace({
    url: "https://customer.example",
    outDir,
    profilePath,
    frameworkRoot,
    now: NOW,
  });

  const target = JSON.parse(await readFile(result.targetPath, "utf8"));
  const manifestText = await readFile(result.manifestPath, "utf8");
  assert.equal(target.candidate.name, "Private Candidate");
  assert.equal(target.candidate.contact.email, "private.candidate@example.net");
  assert.equal(target.campaign.targetRole, "AI operations partner");
  assert.equal(manifestText.includes("Private Candidate"), false);
  assert.equal(manifestText.includes(profilePath), false);
  assert.equal(JSON.stringify(result).includes("Private Candidate"), false);
  assert.equal(JSON.stringify(result).includes(profilePath), false);
});

test("invalid private profile errors do not echo profile contents", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const profilePath = join(root, "invalid.private.json");
  const secretMarker = "DO_NOT_ECHO_THIS_PRIVATE_VALUE";
  await writeFile(profilePath, JSON.stringify({ candidate: { instructions: secretMarker } }));

  let caught;
  try {
    await initWorkspace({
      url: "https://customer.example",
      outDir: join(root, "invalid-profile-workspace"),
      profilePath,
      frameworkRoot,
      now: NOW,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof WorkspaceInitializationError, true);
  assert.equal(caught.code, WORKSPACE_ERROR_CODES.PROFILE_INVALID);
  assert.equal(`${caught.message}${JSON.stringify(caught.diagnostics)}`.includes(secretMarker), false);
});

test("partial private profile cannot inherit candidate placeholders", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const profilePath = join(root, "partial.private.json");
  await writeFile(profilePath, JSON.stringify({
    name: "Incomplete Candidate",
    contact: { profileUrl: "https://example.net/profile" },
  }));

  await assert.rejects(
    initWorkspace({
      url: "https://customer.example",
      outDir: join(root, "partial-profile-workspace"),
      profilePath,
      frameworkRoot,
      now: NOW,
    }),
    (error) =>
      error instanceof WorkspaceInitializationError &&
      error.code === WORKSPACE_ERROR_CODES.PROFILE_INVALID,
  );
});

test("profile validation uses the workspace deterministic clock", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const profilePath = join(root, "future-clock-profile.json");
  await writeFile(profilePath, JSON.stringify({
    name: "Clock Test",
    role: "AI workflow operator",
    bio: "Tests deterministic validation dates.",
    locationTimezone: "UTC+0",
    contact: { profileUrl: "https://example.net/profile" },
    proofLinks: [{ label: "Work", url: "https://example.net/work" }],
  }));

  const result = await initWorkspace({
    url: "https://customer.example",
    outDir: join(root, "future-clock-workspace"),
    profilePath,
    frameworkRoot,
    now: "2030-01-02T12:00:00.000Z",
  });
  const target = JSON.parse(await readFile(result.targetPath, "utf8"));
  assert.equal(target.researchDate, "2030-01-02");
  assert.equal(validateTarget(target, { now: "2030-01-02T12:00:00.000Z" }).valid, true);
});

test("a profile without email does not retain the template mailbox", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const profilePath = join(root, "profile-without-email.json");
  await writeFile(profilePath, JSON.stringify({
    name: "Profile Link Only",
    role: "AI workflow operator",
    bio: "Prepares evidence-led workflow tests.",
    locationTimezone: "UTC+0",
    contact: { profileUrl: "https://example.net/profile" },
    proofLinks: [{ label: "Work", url: "https://example.net/work" }],
  }));

  const result = await initWorkspace({
    url: "https://customer.example",
    outDir: join(root, "email-optional"),
    profilePath,
    frameworkRoot,
    now: NOW,
  });
  const target = JSON.parse(await readFile(result.targetPath, "utf8"));
  assert.equal(Object.hasOwn(target.candidate.contact, "email"), false);
  assert.equal(validateTarget(target, { now: NOW }).valid, true);
});

test("private profile must remain outside the customer workspace", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const outDir = join(root, "profile-boundary");
  const profilePath = join(outDir, "candidate.json");

  await assert.rejects(
    initWorkspace({
      url: "https://customer.example",
      outDir,
      profilePath,
      frameworkRoot,
      now: NOW,
    }),
    (error) =>
      error instanceof WorkspaceInitializationError &&
      error.code === WORKSPACE_ERROR_CODES.PROFILE_WORKSPACE_FORBIDDEN,
  );
  assert.equal(await pathExists(outDir), false);
});

test("private profile cannot enter through an ancestor junction alias", async (t) => {
  const { root, frameworkRoot } = await fixture(t);
  const physicalParent = join(root, "physical-parent");
  const aliasParent = join(root, "alias-parent");
  const physicalWorkspace = join(physicalParent, "customer");
  const aliasedWorkspace = join(aliasParent, "customer");
  const profilePath = join(physicalWorkspace, "node_modules", "candidate.json");
  await mkdir(join(physicalWorkspace, "node_modules"), { recursive: true });
  await writeFile(profilePath, JSON.stringify({
    name: "Boundary Test",
    role: "AI workflow operator",
    bio: "Tests canonical workspace boundaries.",
    locationTimezone: "UTC+0",
    contact: { profileUrl: "https://example.net/profile" },
    proofLinks: [{ label: "Work", url: "https://example.net/work" }],
  }));
  try {
    await symlink(physicalParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
      t.skip(`Directory-link creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    initWorkspace({
      url: "https://customer.example",
      outDir: aliasedWorkspace,
      profilePath,
      frameworkRoot,
      now: NOW,
    }),
    (error) =>
      error instanceof WorkspaceInitializationError &&
      error.code === WORKSPACE_ERROR_CODES.PROFILE_WORKSPACE_FORBIDDEN,
  );
  assert.equal(await pathExists(join(aliasedWorkspace, ".aomk")), false);
});
