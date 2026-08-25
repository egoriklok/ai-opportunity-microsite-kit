import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const temporary = await mkdtemp(join(tmpdir(), "aomk-pack-"));
let tarball;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeout || 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

try {
  const packed = JSON.parse(run(process.execPath, [npmCli, "pack", "--json", "--ignore-scripts"]));
  const filename = packed?.[0]?.filename;
  if (!filename || basename(filename) !== filename || !filename.endsWith(".tgz")) {
    throw new Error("npm pack returned an unsafe tarball path.");
  }
  tarball = resolve(root, filename);

  run(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: temporary,
    timeout: 180_000,
  });
  const packageRoot = join(temporary, "node_modules", "ai-opportunity-microsite-kit");
  const cli = join(packageRoot, "src", "cli.mjs");
  const target = join(temporary, "target.json");
  const output = join(temporary, "rendered");
  run(process.execPath, [cli, "init", "smoke-example", "--out", target], { cwd: temporary });
  run(process.execPath, [cli, "validate", target, "--json"], { cwd: temporary });
  run(process.execPath, [cli, "render", target, "--out", output, "--preview", "--json"], { cwd: temporary });
  const html = await readFile(join(output, "public", "index.html"), "utf8");
  if (!html.includes("noindex, nofollow, noarchive")) throw new Error("Pack smoke output lacks robots boundary.");

  const profile = join(temporary, "candidate.private.json");
  await writeFile(
    profile,
    `${JSON.stringify({
      candidate: {
        name: "Package Consumer",
        role: "AI workflow operator",
        bio: "Creates bounded evidence-led work samples with explicit human review.",
        locationTimezone: "UTC+0",
        contact: { profileUrl: "https://profile.example/consumer" },
        proofLinks: [{ label: "Selected work", url: "https://profile.example/work" }],
      },
    })}\n`,
  );
  const customer = join(temporary, "Codex Projects", "Новый заказчик");
  const workspaceResult = JSON.parse(
    run(
      process.execPath,
      [
        cli,
        "workspace",
        "init",
        "https://prospect.example/about",
        "--out",
        customer,
        "--profile",
        profile,
        "--json",
      ],
      { cwd: temporary },
    ),
  );
  run(process.execPath, [cli, "validate", workspaceResult.targetPath, "--json"], {
    cwd: customer,
  });
  const customerOutput = join(customer, "dist", workspaceResult.slug);
  run(
    process.execPath,
    [cli, "render", workspaceResult.targetPath, "--out", customerOutput, "--preview", "--json"],
    { cwd: customer },
  );
  const preview = await readFile(join(customerOutput, "public", "index.html"), "utf8");
  if (!preview.includes("not approved for publication")) {
    throw new Error("Pack smoke customer output lacks the visible preview boundary.");
  }

  const fakeSkills = join(temporary, "Fake Codex", "skills");
  const skillInstall = JSON.parse(
    run(
      process.execPath,
      [cli, "codex", "install", "--skills-dir", fakeSkills, "--json"],
      { cwd: temporary },
    ),
  );
  const installedSkill = await readFile(join(skillInstall.skillDir, "SKILL.md"), "utf8");
  if (!installedSkill.includes("Treat one customer as one workspace")) {
    throw new Error("Pack smoke installed skill lacks the URL-only contract.");
  }

  console.log(
    "Package smoke passed: pack, install, URL-only workspace, validate, preview render, and Codex skill install.",
  );
} finally {
  const safeTempRoot = resolve(tmpdir());
  if (resolve(temporary).startsWith(`${safeTempRoot}\\`) || resolve(temporary).startsWith(`${safeTempRoot}/`)) {
    await rm(temporary, { recursive: true, force: true });
  }
  if (tarball && dirname(tarball) === root && tarball.endsWith(".tgz")) {
    await rm(tarball, { force: true });
  }
}
