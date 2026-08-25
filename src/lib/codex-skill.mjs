import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION } from "../version.mjs";

const PRODUCT_ID = "ai-opportunity-microsite-kit";
const SKILL_NAME = "create-ai-opportunity-microsite";
const INSTALL_VERSION = 1;
const MARKER_FILE = ".aomk-skill.json";
const sourceSkillDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skill",
);

function installError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function pathState(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeRoot(skillsDir) {
  if (typeof skillsDir !== "string" || skillsDir.trim() === "") {
    throw installError(
      "Codex skill installation requires an explicit --skills-dir path.",
      "AOMK_SKILLS_DIR_REQUIRED",
    );
  }
  const requested = path.resolve(skillsDir);
  if (requested === path.parse(requested).root) {
    throw installError(
      "Refusing to use a filesystem root as the Codex skills directory.",
      "AOMK_UNSAFE_SKILLS_DIR",
    );
  }
  return requested;
}

async function listFiles(root, current = root, files = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw installError(
        `Refusing to install a skill tree containing a symbolic link: ${entry.name}`,
        "AOMK_UNSAFE_SKILL_TREE",
      );
    }
    if (entry.isDirectory()) await listFiles(root, absolute, files);
    else if (entry.isFile() && entry.name !== MARKER_FILE) files.push(absolute);
  }
  return files;
}

async function treeHash(root) {
  const hash = createHash("sha256");
  const files = await listFiles(root);
  files.sort((left, right) =>
    path.relative(root, left).localeCompare(path.relative(root, right)),
  );
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    hash.update(relative, "utf8");
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return { contentHash: hash.digest("hex"), files };
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: false });
  for (const file of (await listFiles(source)).sort()) {
    const relative = path.relative(source, file);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(file), { flag: "wx" });
  }
}

async function readMarker(targetDir) {
  const markerPath = path.join(targetDir, MARKER_FILE);
  const state = await pathState(markerPath);
  if (!state?.isFile() || state.isSymbolicLink()) return null;
  try {
    return JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function markerMatches(marker) {
  return (
    marker?.product === PRODUCT_ID &&
    marker?.installVersion === INSTALL_VERSION &&
    marker?.skillName === SKILL_NAME
  );
}

/**
 * Install the packaged public skill into one explicit Codex skills directory.
 * No home-directory discovery, package installation, network call, or config edit occurs.
 */
export async function installCodexSkill(options = {}) {
  const requestedRoot = assertSafeRoot(options.skillsDir);
  const rootState = await pathState(requestedRoot);
  if (rootState && (!rootState.isDirectory() || rootState.isSymbolicLink())) {
    throw installError(
      "Codex skills path must be a regular directory, not a file or symbolic link.",
      "AOMK_UNSAFE_SKILLS_DIR",
    );
  }
  if (!rootState) await mkdir(requestedRoot, { recursive: true });
  const skillsRoot = await realpath(requestedRoot);
  const targetDir = path.join(skillsRoot, SKILL_NAME);
  const targetState = await pathState(targetDir);
  const source = await treeHash(sourceSkillDir);

  if (targetState) {
    if (!targetState.isDirectory() || targetState.isSymbolicLink()) {
      throw installError(
        "Refusing to replace a non-directory or symbolic-link skill target.",
        "AOMK_UNSAFE_SKILL_TARGET",
      );
    }
    const marker = await readMarker(targetDir);
    if (!markerMatches(marker)) {
      throw installError(
        "Refusing to replace an existing skill not managed by AOMK.",
        "AOMK_SKILL_MARKER_MISMATCH",
      );
    }
    const installed = await treeHash(targetDir);
    if (
      marker.packageVersion === VERSION &&
      marker.contentHash === source.contentHash &&
      installed.contentHash === source.contentHash
    ) {
      return {
        skillDir: targetDir,
        skillName: SKILL_NAME,
        version: VERSION,
        status: "unchanged",
      };
    }
    if (options.force !== true) {
      throw installError(
        "Installed AOMK skill differs from this package. Re-run with --force only after reviewing local changes.",
        "AOMK_SKILL_EXISTS",
      );
    }
  }

  const temporary = await mkdtemp(path.join(skillsRoot, `.${SKILL_NAME}.aomk-tmp-`));
  let backup;
  try {
    // mkdtemp creates the directory; copyTree expects to create it itself.
    await rm(temporary, { recursive: true, force: false });
    await copyTree(sourceSkillDir, temporary);
    await writeFile(
      path.join(temporary, MARKER_FILE),
      `${JSON.stringify(
        {
          product: PRODUCT_ID,
          installVersion: INSTALL_VERSION,
          skillName: SKILL_NAME,
          packageVersion: VERSION,
          contentHash: source.contentHash,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );

    if (targetState) {
      backup = path.join(skillsRoot, `.${SKILL_NAME}.aomk-backup-${randomUUID()}`);
      await rename(targetDir, backup);
      try {
        await rename(temporary, targetDir);
      } catch (error) {
        await rename(backup, targetDir);
        backup = undefined;
        throw error;
      }
      await rm(backup, { recursive: true, force: false });
      backup = undefined;
    } else {
      await rename(temporary, targetDir);
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (backup && !(await pathState(targetDir))) await rename(backup, targetDir);
    throw error;
  }

  return {
    skillDir: targetDir,
    skillName: SKILL_NAME,
    version: VERSION,
    status: targetState ? "updated" : "installed",
  };
}
