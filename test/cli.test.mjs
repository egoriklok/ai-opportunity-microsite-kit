import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXIT, main } from "../src/cli.mjs";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (value) => { stdout += String(value); } },
    stderr: { write: (value) => { stderr += String(value); } },
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; },
  };
}

test("CLI help and version expose stable commands", async () => {
  const helpIo = captureIo();
  assert.equal(await main(["--help"], helpIo), EXIT.OK);
  assert.match(helpIo.stdoutText, /aomk workspace init/);
  assert.match(helpIo.stdoutText, /aomk codex install/);
  assert.match(helpIo.stdoutText, /aomk reach doctor/);
  assert.match(helpIo.stdoutText, /Only <directory>\/public is publishable/);

  const versionIo = captureIo();
  assert.equal(await main(["--version"], versionIo), EXIT.OK);
  assert.match(versionIo.stdoutText, /^0\.2\.0/);
});

test("CLI installs the public Codex skill only into an explicit directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-cli-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillsDir = join(root, "Codex Skills");

  const installIo = captureIo();
  assert.equal(
    await main(["codex", "install", "--skills-dir", skillsDir, "--json"], installIo),
    EXIT.OK,
  );
  const result = JSON.parse(installIo.stdoutText);
  assert.equal(result.status, "installed");
  assert.match(
    await readFile(join(result.skillDir, "agents", "openai.yaml"), "utf8"),
    /\$create-ai-opportunity-microsite/,
  );

  const usageIo = captureIo();
  assert.equal(await main(["codex", "install"], usageIo), EXIT.USAGE);
  assert.match(usageIo.stderrText, /USAGE_ERROR/);

  const unknownFlagIo = captureIo();
  assert.equal(
    await main(["codex", "install", "--skills-dir", skillsDir, "--unexpected", "value"], unknownFlagIo),
    EXIT.USAGE,
  );
  assert.match(unknownFlagIo.stderrText, /USAGE_ERROR/);
});

test("CLI initializes one isolated URL-only customer workspace without publishing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-cli-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "Новый заказчик");
  const initIo = captureIo();

  assert.equal(
    await main(
      [
        "workspace",
        "init",
        "https://prospect.example/about?tracking=removed",
        "--out",
        workspace,
        "--locale",
        "ru",
        "--json",
      ],
      initIo,
    ),
    EXIT.OK,
  );
  const initialized = JSON.parse(initIo.stdoutText);
  assert.equal(initialized.slug, "prospect-example");
  assert.equal(initialized.reused, false);
  assert.equal(initIo.stdoutText.includes("Candidate Name"), false);
  assert.equal(await readFile(join(workspace, ".gitignore"), "utf8").then((value) => value.includes("targets/")), true);
  await assert.rejects(readFile(join(workspace, "dist", "prospect-example", "public", "index.html")));

  const usageIo = captureIo();
  assert.equal(
    await main(["workspace", "init", "https://prospect.example", "--out", workspace, "--force"], usageIo),
    EXIT.USAGE,
  );
  assert.match(usageIo.stderrText, /USAGE_ERROR/);
});

test("CLI init, validate, and render complete without publishing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-cli-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target.json");
  const output = join(root, "output");

  const initIo = captureIo();
  assert.equal(
    await main(["init", "cli-example", "--out", target, "--company", "CLI Example"], initIo),
    EXIT.OK,
  );

  const validateIo = captureIo();
  assert.equal(await main(["validate", target, "--json"], validateIo), EXIT.OK);
  const validation = JSON.parse(validateIo.stdoutText);
  assert.equal(validation.valid, true);
  assert.equal("value" in validation, false);
  assert.equal(validateIo.stdoutText.includes("Draft outreach"), false);
  assert.equal(
    validation.warnings.some((item) => item.code === "TARGET_NOT_PUBLICATION_READY"),
    true,
  );

  const renderIo = captureIo();
  assert.equal(await main(["render", target, "--out", output, "--preview", "--json"], renderIo), EXIT.OK);
  const result = JSON.parse(renderIo.stdoutText);
  assert.equal(result.files.includes("public/index.html"), true);
  assert.match(await readFile(join(output, "public", "index.html"), "utf8"), /noindex, nofollow, noarchive/);
  assert.match(await readFile(join(output, "public", "index.html"), "utf8"), /not approved for publication/);
});

test("CLI uses stable exit codes for invalid JSON and usage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-cli-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invalid = join(root, "invalid.json");
  await writeFile(invalid, "{not-json}\n");

  const invalidIo = captureIo();
  assert.equal(await main(["validate", invalid], invalidIo), EXIT.INVALID);
  assert.match(invalidIo.stderrText, /JSON_PARSE_ERROR/);

  const usageIo = captureIo();
  assert.equal(await main(["render"], usageIo), EXIT.USAGE);
  assert.match(usageIo.stderrText, /USAGE_ERROR/);
});

test("CLI blocks production rendering when validation warnings remain", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aomk-cli-warning-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const targetPath = join(root, "target.json");
  const target = JSON.parse(
    await readFile(new URL("../examples/nordform/target.json", import.meta.url), "utf8"),
  );
  target.site.cta = "This will guarantee ROI with zero risk.";
  await writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`);

  const io = captureIo();
  assert.equal(
    await main(["render", targetPath, "--out", join(root, "output"), "--json"], io),
    EXIT.INVALID,
  );
  const result = JSON.parse(io.stdoutText);
  assert.equal(result.errors.some((item) => item.code === "RENDER_WARNINGS_BLOCKED"), true);
  assert.equal(io.stdoutText.includes(target.candidate.contact.email), false);
});
