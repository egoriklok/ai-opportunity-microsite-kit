import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installCodexSkill } from "../src/lib/codex-skill.mjs";

async function tempCase(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aomk-codex-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("installs the packaged skill into an explicit Unicode path and is idempotent", async (t) => {
  const root = await tempCase(t);
  const skillsDir = path.join(root, "Codex Skills", "Навыки");
  const first = await installCodexSkill({ skillsDir });
  assert.equal(first.status, "installed");
  assert.equal(first.skillName, "create-ai-opportunity-microsite");

  const instructions = await readFile(path.join(first.skillDir, "SKILL.md"), "utf8");
  const interfaceYaml = await readFile(
    path.join(first.skillDir, "agents", "openai.yaml"),
    "utf8",
  );
  const marker = JSON.parse(
    await readFile(path.join(first.skillDir, ".aomk-skill.json"), "utf8"),
  );
  assert.match(instructions, /create-ai-opportunity-microsite/);
  assert.match(interfaceYaml, /\$create-ai-opportunity-microsite/);
  assert.equal(marker.contentHash.length, 64);

  const second = await installCodexSkill({ skillsDir });
  assert.equal(second.status, "unchanged");
});

test("protects modified and foreign skill directories", async (t) => {
  const root = await tempCase(t);
  const skillsDir = path.join(root, "skills");
  const installed = await installCodexSkill({ skillsDir });
  await writeFile(path.join(installed.skillDir, "SKILL.md"), "locally modified\n");

  await assert.rejects(
    installCodexSkill({ skillsDir }),
    (error) => error.code === "AOMK_SKILL_EXISTS",
  );
  const replaced = await installCodexSkill({ skillsDir, force: true });
  assert.equal(replaced.status, "updated");
  assert.match(
    await readFile(path.join(replaced.skillDir, "SKILL.md"), "utf8"),
    /create-ai-opportunity-microsite/,
  );

  const foreignRoot = path.join(root, "foreign");
  const foreignSkill = path.join(foreignRoot, "create-ai-opportunity-microsite");
  await mkdir(foreignSkill, { recursive: true });
  await writeFile(path.join(foreignSkill, "SKILL.md"), "foreign\n");
  await assert.rejects(
    installCodexSkill({ skillsDir: foreignRoot, force: true }),
    (error) => error.code === "AOMK_SKILL_MARKER_MISMATCH",
  );
});

test("requires an explicit non-root skills directory", async () => {
  await assert.rejects(
    installCodexSkill({}),
    (error) => error.code === "AOMK_SKILLS_DIR_REQUIRED",
  );
  await assert.rejects(
    installCodexSkill({ skillsDir: path.parse(process.cwd()).root }),
    (error) => error.code === "AOMK_UNSAFE_SKILLS_DIR",
  );
});
