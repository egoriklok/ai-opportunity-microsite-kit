import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { domainToUnicode, fileURLToPath } from "node:url";

import { initTarget } from "./init.mjs";
import { POLICY_PROFILES, validateTarget } from "./validate.mjs";

const FRAMEWORK_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const WORKSPACE_SCHEMA_VERSION = "1.0.0";
const MANAGED_BY = "ai-opportunity-microsite-kit";
const MAX_PRIVATE_PROFILE_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const SAFE_DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SAFE_LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const SAFE_NPM_ROOT_ENTRIES = new Set([
  "node_modules",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
]);
const WORKSPACE_OPTION_NAMES = new Set([
  "frameworkRoot",
  "intent",
  "locale",
  "now",
  "outDir",
  "policyProfile",
  "profilePath",
  "url",
]);
const CANDIDATE_KEYS = new Set([
  "bio",
  "contact",
  "locationTimezone",
  "name",
  "proofLinks",
  "role",
]);
const CONTACT_KEYS = new Set(["email", "profileUrl"]);
const PROOF_LINK_KEYS = new Set(["label", "url"]);

const customerTemplateRoot = new URL("../../templates/customer-workspace/", import.meta.url);
const AGENTS_TEMPLATE = readFileSync(new URL("AGENTS.md", customerTemplateRoot), "utf8");
const GITIGNORE_TEMPLATE = readFileSync(new URL("gitignore.template", customerTemplateRoot), "utf8");
const GOAL_TEMPLATE = readFileSync(new URL("GOAL.md", customerTemplateRoot), "utf8");

export const WORKSPACE_ERROR_CODES = Object.freeze({
  DIRECTORY_FOREIGN: "WORKSPACE_DIRECTORY_FOREIGN",
  FILE_COLLISION: "WORKSPACE_FILE_COLLISION",
  FRAMEWORK_PATH_FORBIDDEN: "WORKSPACE_FRAMEWORK_PATH_FORBIDDEN",
  IO_FAILED: "WORKSPACE_IO_FAILED",
  MANIFEST_INVALID: "WORKSPACE_MANIFEST_INVALID",
  OPTIONS_INVALID: "WORKSPACE_OPTIONS_INVALID",
  OUTPUT_INVALID: "WORKSPACE_OUTPUT_INVALID",
  OUTPUT_ROOT_FORBIDDEN: "WORKSPACE_OUTPUT_ROOT_FORBIDDEN",
  POLICY_INVALID: "WORKSPACE_POLICY_INVALID",
  PROFILE_INVALID: "WORKSPACE_PROFILE_INVALID",
  PROFILE_READ_FAILED: "WORKSPACE_PROFILE_READ_FAILED",
  PROFILE_WORKSPACE_FORBIDDEN: "WORKSPACE_PROFILE_WORKSPACE_FORBIDDEN",
  SYMLINK_FORBIDDEN: "WORKSPACE_SYMLINK_FORBIDDEN",
  URL_HTTPS_REQUIRED: "WORKSPACE_URL_HTTPS_REQUIRED",
  URL_INVALID: "WORKSPACE_URL_INVALID",
  URL_UNSUPPORTED_HOST: "WORKSPACE_URL_UNSUPPORTED_HOST",
  WORKSPACE_MISMATCH: "WORKSPACE_IDENTITY_MISMATCH",
});

export class WorkspaceInitializationError extends Error {
  constructor(code, message, path = "/") {
    super(message);
    this.name = "WorkspaceInitializationError";
    this.code = code;
    this.diagnostics = [{ severity: "error", code, path, message }];
  }
}

function fail(code, message, path) {
  throw new WorkspaceInitializationError(code, message, path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function assertOptions(options) {
  if (!isPlainObject(options)) {
    fail(WORKSPACE_ERROR_CODES.OPTIONS_INVALID, "Workspace options must be a plain object.");
  }
  if (Object.keys(options).some((key) => !WORKSPACE_OPTION_NAMES.has(key))) {
    fail(WORKSPACE_ERROR_CODES.OPTIONS_INVALID, "Workspace options contain an unsupported field.");
  }
  if (typeof options.url !== "string" || options.url.trim().length === 0) {
    fail(WORKSPACE_ERROR_CODES.URL_INVALID, "A customer website URL is required.", "/url");
  }
  if (typeof options.outDir !== "string" || options.outDir.trim().length === 0) {
    fail(WORKSPACE_ERROR_CODES.OUTPUT_INVALID, "A non-empty output directory is required.", "/outDir");
  }
  if (options.profilePath !== undefined && (typeof options.profilePath !== "string" || options.profilePath.length === 0)) {
    fail(WORKSPACE_ERROR_CODES.PROFILE_INVALID, "Candidate profile path must be a non-empty string.", "/profilePath");
  }
}

function normalizeWebsiteUrl(value) {
  let website;
  try {
    website = new URL(value);
  } catch {
    fail(WORKSPACE_ERROR_CODES.URL_INVALID, "Customer website must be a valid absolute URL.", "/url");
  }
  if (website.protocol !== "https:") {
    fail(WORKSPACE_ERROR_CODES.URL_HTTPS_REQUIRED, "Customer website must use HTTPS.", "/url");
  }
  if (website.username || website.password) {
    fail(WORKSPACE_ERROR_CODES.URL_INVALID, "Customer website URL must not contain credentials.", "/url");
  }
  const labels = website.hostname.split(".");
  const topLevelDomain = labels.at(-1) ?? "";
  const hasSupportedTopLevelDomain =
    /^[A-Za-z]{2,63}$/.test(topLevelDomain) ||
    /^xn--[A-Za-z0-9-]{2,59}$/i.test(topLevelDomain);
  if (
    website.hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !SAFE_DNS_LABEL.test(label)) ||
    !hasSupportedTopLevelDomain
  ) {
    fail(
      WORKSPACE_ERROR_CODES.URL_UNSUPPORTED_HOST,
      "Customer website must use a supported public DNS hostname.",
      "/url",
    );
  }
  website.hash = "";
  website.search = "";
  return website;
}

function slugFromHostname(hostname) {
  const withoutWww = hostname.toLowerCase().replace(/^www\./, "");
  const slug = withoutWww
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (!slug) {
    fail(WORKSPACE_ERROR_CODES.URL_UNSUPPORTED_HOST, "Customer hostname cannot form a safe workspace slug.", "/url");
  }
  return slug;
}

function companyNameFromHostname(hostname) {
  const labels = domainToUnicode(hostname).replace(/^www\./i, "").split(".");
  const label = labels[0];
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isSameOrBelow(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..\\") && !child.startsWith("../") && child !== ".." && !isAbsolute(child));
}

async function canonicalPotentialPath(inputPath) {
  const suffix = [];
  let cursor = resolve(inputPath);
  while (true) {
    try {
      return resolve(await realpath(cursor), ...suffix);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function safeLstat(pathname) {
  try {
    return await lstat(pathname);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertManagedDirectory(pathname, diagnosticPath) {
  const status = await safeLstat(pathname);
  if (status?.isSymbolicLink()) {
    fail(WORKSPACE_ERROR_CODES.SYMLINK_FORBIDDEN, "Managed workspace directories cannot be symbolic links.", diagnosticPath);
  }
  if (status && !status.isDirectory()) {
    fail(WORKSPACE_ERROR_CODES.FILE_COLLISION, "Managed workspace directory collides with a non-directory entry.", diagnosticPath);
  }
  return status;
}

async function assertOutputBoundary(outDir, frameworkRoot) {
  const outputPath = resolve(outDir);
  if (parse(outputPath).root === outputPath) {
    fail(WORKSPACE_ERROR_CODES.OUTPUT_ROOT_FORBIDDEN, "Filesystem roots cannot be customer workspaces.", "/outDir");
  }

  const frameworkPath = resolve(frameworkRoot);
  const [canonicalOutput, canonicalFramework] = await Promise.all([
    canonicalPotentialPath(outputPath),
    canonicalPotentialPath(frameworkPath),
  ]);
  if (
    isSameOrBelow(frameworkPath, outputPath) ||
    isSameOrBelow(canonicalFramework, canonicalOutput)
  ) {
    fail(
      WORKSPACE_ERROR_CODES.FRAMEWORK_PATH_FORBIDDEN,
      "Customer workspace cannot be the framework checkout or one of its descendants.",
      "/outDir",
    );
  }

  const outputStatus = await safeLstat(outputPath);
  if (outputStatus?.isSymbolicLink()) {
    fail(WORKSPACE_ERROR_CODES.SYMLINK_FORBIDDEN, "Customer workspace cannot be a symbolic link.", "/outDir");
  }
  if (outputStatus && !outputStatus.isDirectory()) {
    fail(WORKSPACE_ERROR_CODES.OUTPUT_INVALID, "Customer workspace output must be a directory.", "/outDir");
  }
  return { outputPath, canonicalOutput };
}

async function assertSafeNpmConsumerEntry(root, entry) {
  const status = await safeLstat(resolve(root, entry.name));
  if (!status || status.isSymbolicLink()) {
    fail(WORKSPACE_ERROR_CODES.SYMLINK_FORBIDDEN, "Fresh consumer files cannot be symbolic links.", "/outDir");
  }
  if (entry.name === "node_modules") {
    if (!status.isDirectory()) {
      fail(WORKSPACE_ERROR_CODES.DIRECTORY_FOREIGN, "node_modules must be a directory.", "/outDir");
    }
  } else if (!status.isFile()) {
    fail(WORKSPACE_ERROR_CODES.DIRECTORY_FOREIGN, "Fresh npm metadata must be regular files.", "/outDir");
  }
}

async function assertFreshConsumerDirectory(root, entries) {
  for (const entry of entries) {
    if (!SAFE_NPM_ROOT_ENTRIES.has(entry.name)) {
      fail(
        WORKSPACE_ERROR_CODES.DIRECTORY_FOREIGN,
        "Refusing to initialize a non-empty directory that is not a fresh npm consumer.",
        "/outDir",
      );
    }
    await assertSafeNpmConsumerEntry(root, entry);
  }
}

async function readManagedManifest(manifestPath) {
  const status = await safeLstat(manifestPath);
  if (!status) return null;
  if (status.isSymbolicLink()) {
    fail(WORKSPACE_ERROR_CODES.SYMLINK_FORBIDDEN, "Workspace manifest cannot be a symbolic link.", "/.aomk/workspace.json");
  }
  if (!status.isFile() || status.size > MAX_MANIFEST_BYTES) {
    fail(WORKSPACE_ERROR_CODES.MANIFEST_INVALID, "Workspace manifest is not a supported regular file.", "/.aomk/workspace.json");
  }
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    fail(WORKSPACE_ERROR_CODES.MANIFEST_INVALID, "Workspace manifest is not valid JSON.", "/.aomk/workspace.json");
  }
}

function assertManifestIdentity(manifest, expected) {
  if (
    !isPlainObject(manifest) ||
    manifest.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
    manifest.managedBy !== MANAGED_BY ||
    manifest.workspaceId !== expected.workspaceId ||
    manifest?.source?.websiteUrl !== expected.source.websiteUrl ||
    manifest?.source?.hostname !== expected.source.hostname ||
    manifest?.target?.slug !== expected.target.slug ||
    manifest?.target?.path !== expected.target.path ||
    manifest?.initialization?.locale !== expected.initialization.locale ||
    manifest?.initialization?.intent !== expected.initialization.intent ||
    manifest?.initialization?.policyProfile !== expected.initialization.policyProfile ||
    manifest?.initialization?.privateProfileApplied !== expected.initialization.privateProfileApplied
  ) {
    fail(
      WORKSPACE_ERROR_CODES.WORKSPACE_MISMATCH,
      "Existing AOMK workspace identity does not match this initialization request.",
      "/.aomk/workspace.json",
    );
  }
}

function validateWorkspaceSettings(options) {
  const locale = options.locale ?? "en";
  const intent = options.intent ?? "collaboration";
  const policyProfile = options.policyProfile ?? (intent === "employment" ? "employment-cold-v1" : "collaboration-cold-v1");
  if (!SAFE_LOCALE.test(locale)) {
    fail(WORKSPACE_ERROR_CODES.POLICY_INVALID, "Locale must use a supported language or language-region form.", "/locale");
  }
  if (!new Set(["employment", "collaboration"]).has(intent)) {
    fail(WORKSPACE_ERROR_CODES.POLICY_INVALID, "Intent must be employment or collaboration.", "/intent");
  }
  if (!Object.hasOwn(POLICY_PROFILES, policyProfile)) {
    fail(WORKSPACE_ERROR_CODES.POLICY_INVALID, "Policy profile is not supported.", "/policyProfile");
  }
  const policy = POLICY_PROFILES[policyProfile];
  if (policy && policy.intent !== intent) {
    fail(WORKSPACE_ERROR_CODES.POLICY_INVALID, "Policy profile does not match the selected intent.", "/policyProfile");
  }
  return { locale, intent, policyProfile };
}

function assertProfileShape(profile) {
  if (!hasOnlyKeys(profile, CANDIDATE_KEYS)) return false;
  for (const key of ["name", "role", "bio", "locationTimezone", "contact", "proofLinks"]) {
    if (!Object.hasOwn(profile, key)) return false;
  }
  if (!hasOnlyKeys(profile.contact, CONTACT_KEYS) || !Object.hasOwn(profile.contact, "profileUrl")) return false;
  if (
    !Array.isArray(profile.proofLinks) ||
    profile.proofLinks.length === 0 ||
    profile.proofLinks.some((link) => !hasOnlyKeys(link, PROOF_LINK_KEYS))
  ) return false;
  return true;
}

async function readCandidateProfile(profilePath, outputPath, canonicalOutput) {
  const absoluteProfile = resolve(profilePath);
  const canonicalProfile = await canonicalPotentialPath(absoluteProfile).catch(() => absoluteProfile);
  if (
    isSameOrBelow(outputPath, absoluteProfile) ||
    isSameOrBelow(outputPath, canonicalProfile) ||
    isSameOrBelow(canonicalOutput, absoluteProfile) ||
    isSameOrBelow(canonicalOutput, canonicalProfile)
  ) {
    fail(
      WORKSPACE_ERROR_CODES.PROFILE_WORKSPACE_FORBIDDEN,
      "Keep the private candidate profile outside the customer workspace.",
      "/profilePath",
    );
  }
  let status;
  let parsed;
  try {
    status = await lstat(absoluteProfile);
    if (!status.isFile() || status.size > MAX_PRIVATE_PROFILE_BYTES) throw new Error("unsupported profile file");
    parsed = JSON.parse(await readFile(absoluteProfile, "utf8"));
  } catch {
    fail(
      WORKSPACE_ERROR_CODES.PROFILE_READ_FAILED,
      "Unable to read the private candidate profile as a bounded JSON file.",
      "/profilePath",
    );
  }

  let candidate = parsed;
  if (hasOnlyKeys(parsed, new Set(["candidate"])) && Object.hasOwn(parsed, "candidate")) {
    candidate = parsed.candidate;
  }
  if (!assertProfileShape(candidate)) {
    fail(WORKSPACE_ERROR_CODES.PROFILE_INVALID, "Private candidate profile has an unsupported shape.", "/profilePath");
  }
  return candidate;
}

function applyCandidateProfile(target, candidate, now) {
  if (!candidate) return target;
  for (const key of ["name", "role", "bio", "locationTimezone"]) {
    if (candidate[key] !== undefined) target.candidate[key] = candidate[key];
  }
  if (candidate.contact !== undefined) {
    for (const key of ["email", "profileUrl"]) {
      if (candidate.contact[key] !== undefined) target.candidate.contact[key] = candidate.contact[key];
    }
    if (!Object.hasOwn(candidate.contact, "email")) delete target.candidate.contact.email;
  }
  if (candidate.proofLinks !== undefined) {
    target.candidate.proofLinks = JSON.parse(JSON.stringify(candidate.proofLinks));
  }
  if (candidate.role !== undefined) target.campaign.targetRole = candidate.role;
  const result = validateTarget(target, { now: now ?? new Date() });
  if (!result.valid) {
    fail(WORKSPACE_ERROR_CODES.PROFILE_INVALID, "Private candidate profile does not satisfy the target contract.", "/profilePath");
  }
  return target;
}

function renderGoal(values) {
  let result = GOAL_TEMPLATE;
  for (const [name, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${name}}}`, () => String(value));
  }
  return result;
}

async function assertSafeGeneratedPath(pathname, diagnosticPath) {
  const status = await safeLstat(pathname);
  if (status?.isSymbolicLink()) {
    fail(WORKSPACE_ERROR_CODES.SYMLINK_FORBIDDEN, "Managed workspace paths cannot be symbolic links.", diagnosticPath);
  }
  if (status && !status.isFile()) {
    fail(WORKSPACE_ERROR_CODES.FILE_COLLISION, "Managed workspace file path collides with a non-file entry.", diagnosticPath);
  }
  return status;
}

async function writeManagedFile(pathname, content, { preserveExisting, diagnosticPath }) {
  const status = await assertSafeGeneratedPath(pathname, diagnosticPath);
  if (status) {
    if (preserveExisting) return false;
    fail(WORKSPACE_ERROR_CODES.FILE_COLLISION, "Refusing to overwrite an existing workspace file.", diagnosticPath);
  }
  try {
    await writeFile(pathname, content, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(WORKSPACE_ERROR_CODES.FILE_COLLISION, "A workspace file appeared during initialization.", diagnosticPath);
    }
    fail(WORKSPACE_ERROR_CODES.IO_FAILED, "Unable to write a managed workspace file.", diagnosticPath);
  }
  return true;
}

function buildManifest({ website, slug, settings, profileApplied, researchDate }) {
  const sourceUrl = website.href;
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    managedBy: MANAGED_BY,
    workspaceId: createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24),
    initializedOn: researchDate,
    source: {
      websiteUrl: sourceUrl,
      hostname: website.hostname,
    },
    target: {
      slug,
      path: `targets/${slug}/target.json`,
    },
    initialization: {
      locale: settings.locale,
      intent: settings.intent,
      policyProfile: settings.policyProfile,
      privateProfileApplied: profileApplied,
    },
    safety: {
      networkUsedDuringInitialization: false,
      gitInitialized: false,
      publicationAuthorized: false,
      outreachAuthorized: false,
    },
  };
}

function initializationDate(now) {
  const date = new Date(now ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    fail(WORKSPACE_ERROR_CODES.OPTIONS_INVALID, "Initialization date is invalid.", "/now");
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Create or safely resume one isolated, network-free customer workspace.
 * Existing managed files are preserved; unrelated non-empty directories fail closed.
 */
export async function initWorkspace(options = {}) {
  assertOptions(options);
  const website = normalizeWebsiteUrl(options.url.trim());
  const slug = slugFromHostname(website.hostname);
  const settings = validateWorkspaceSettings(options);
  const frameworkRoot = options.frameworkRoot ?? FRAMEWORK_ROOT;
  const { outputPath, canonicalOutput } = await assertOutputBoundary(options.outDir, frameworkRoot);

  if (options.profilePath) {
    const profileResolved = resolve(options.profilePath);
    if (isSameOrBelow(outputPath, profileResolved)) {
      fail(
        WORKSPACE_ERROR_CODES.PROFILE_WORKSPACE_FORBIDDEN,
        "Keep the private candidate profile outside the customer workspace.",
        "/profilePath",
      );
    }
  }

  const outputStatus = await safeLstat(outputPath);
  if (!outputStatus) await mkdir(outputPath, { recursive: true });

  await assertManagedDirectory(outputPath, "/outDir");

  const metadataDir = resolve(outputPath, ".aomk");
  await assertManagedDirectory(metadataDir, "/.aomk");

  const manifestPath = resolve(metadataDir, "workspace.json");
  const existingManifest = await readManagedManifest(manifestPath);
  const entries = await readdir(outputPath, { withFileTypes: true });
  if (!existingManifest) await assertFreshConsumerDirectory(outputPath, entries);

  const expectedManifest = buildManifest({
    website,
    slug,
    settings,
    profileApplied: Boolean(options.profilePath),
    researchDate: initializationDate(options.now),
  });
  const reused = Boolean(existingManifest);
  if (existingManifest) assertManifestIdentity(existingManifest, expectedManifest);

  const targetDir = resolve(outputPath, "targets", slug);
  const targetsDir = resolve(outputPath, "targets");
  const targetPath = resolve(targetDir, "target.json");
  const goalPath = resolve(metadataDir, "GOAL.md");
  const agentsPath = resolve(outputPath, "AGENTS.md");
  const gitignorePath = resolve(outputPath, ".gitignore");
  await assertManagedDirectory(targetsDir, "/targets");
  await assertManagedDirectory(targetDir, `/targets/${slug}`);
  const targetStatus = await assertSafeGeneratedPath(targetPath, `/targets/${slug}/target.json`);

  let target;
  if (!targetStatus) {
    if (
      reused &&
      Boolean(existingManifest.initialization.privateProfileApplied) !== Boolean(options.profilePath)
    ) {
      fail(
        WORKSPACE_ERROR_CODES.WORKSPACE_MISMATCH,
        "Recovering a missing target requires the same private-profile choice as the original initialization.",
        "/profilePath",
      );
    }
    const candidate = options.profilePath
      ? await readCandidateProfile(options.profilePath, outputPath, canonicalOutput)
      : null;
    try {
      target = initTarget({
        slug,
        companyName: companyNameFromHostname(website.hostname),
        domain: website.hostname,
        intent: settings.intent,
        locale: settings.locale,
        now: options.now,
        policyProfile: settings.policyProfile,
        candidateName: candidate?.name,
        targetRole: candidate?.role,
      });
    } catch (error) {
      if (error instanceof WorkspaceInitializationError) throw error;
      if (candidate) {
        fail(WORKSPACE_ERROR_CODES.PROFILE_INVALID, "Private candidate profile does not satisfy the target contract.", "/profilePath");
      }
      fail(WORKSPACE_ERROR_CODES.POLICY_INVALID, "Unable to create a target from the selected workspace settings.", "/");
    }
    target.sources[0].url = website.href;
    applyCandidateProfile(target, candidate, options.now);
  }

  await mkdir(metadataDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  const createdFiles = [];

  if (!existingManifest) {
    if (await writeManagedFile(
      manifestPath,
      `${JSON.stringify(expectedManifest, null, 2)}\n`,
      { preserveExisting: false, diagnosticPath: "/.aomk/workspace.json" },
    )) createdFiles.push(".aomk/workspace.json");
  }

  const goal = renderGoal({
    SOURCE_URL: website.href,
    TARGET_PATH: `targets/${slug}/target.json`,
    LOCALE: settings.locale,
    INTENT: settings.intent,
    POLICY_PROFILE: settings.policyProfile,
    SLUG: slug,
  });
  const managedFiles = [
    [agentsPath, AGENTS_TEMPLATE, "AGENTS.md", "/AGENTS.md"],
    [gitignorePath, GITIGNORE_TEMPLATE, ".gitignore", "/.gitignore"],
    [goalPath, goal, ".aomk/GOAL.md", "/.aomk/GOAL.md"],
  ];
  if (target) {
    managedFiles.push([
      targetPath,
      `${JSON.stringify(target, null, 2)}\n`,
      `targets/${slug}/target.json`,
      `/targets/${slug}/target.json`,
    ]);
  }

  for (const [pathname, content, relativePath, diagnosticPath] of managedFiles) {
    const created = await writeManagedFile(pathname, content, {
      preserveExisting: reused,
      diagnosticPath,
    });
    if (created) createdFiles.push(relativePath);
  }

  return {
    workspaceDir: outputPath,
    slug,
    targetPath,
    goalPath,
    manifestPath,
    createdFiles,
    reused,
  };
}
