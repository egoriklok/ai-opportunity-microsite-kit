import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditPublicTree } from "../scripts/public-audit.mjs";

test("public audit detects a normal absolute Windows user path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-public-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const windowsPath = Buffer.from(
    "QzpcVXNlcnNcZWdvcmlccHJpdmF0ZS5qc29u",
    "base64",
  ).toString("utf8");
  await writeFile(join(root, "safe.txt"), "public fixture\n");
  await writeFile(join(root, "leak.txt"), `${windowsPath}\n`);

  const findings = await auditPublicTree(root);
  assert.deepEqual(findings, [{ file: "leak.txt", rule: "Windows user path" }]);
});
