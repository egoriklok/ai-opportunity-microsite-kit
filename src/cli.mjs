#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  doctorAgentReach,
  initTarget,
  initWorkspace,
  installCodexSkill,
  renderTarget,
  validateTarget,
} from "./index.mjs";
import { VERSION } from "./version.mjs";

export const EXIT = Object.freeze({ OK: 0, INVALID: 1, USAGE: 2, IO: 3, UPSTREAM: 4 });

const HELP = `AI Opportunity Microsite Kit ${VERSION}

Usage:
  aomk init <slug> --out <target.json> [--company <name>] [--domain <host>]
  aomk workspace init <https-url> --out <directory> [--profile <candidate.json>] [--locale <code>] [--intent <intent>] [--policy <profile>] [--json]
  aomk codex install --skills-dir <directory> [--force] [--json]
  aomk validate <target.json|-> [--json]
  aomk render <target.json|-> --out <directory> [--preview] [--force] [--json]
  aomk reach doctor --authorize-upstream [--json]
  aomk --help | --version

Exit codes: 0 success, 1 invalid target, 2 usage, 3 I/O, 4 capability unavailable.
Rendering never publishes or sends anything. Only <directory>/public is publishable.`;

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (["json", "force", "help", "preview", "authorize-upstream"].includes(name)) {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    flags[name] = value;
    index += 1;
  }
  return { positional, flags };
}

async function readTarget(inputPath, stdin = process.stdin) {
  let raw;
  if (inputPath === "-") {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  } else {
    raw = await readFile(resolve(inputPath), "utf8");
  }
  return JSON.parse(raw);
}

function printDiagnostics(result, io, asJson = false) {
  if (asJson) {
    const safeResult = {
      valid: result.valid,
      diagnostics: result.diagnostics,
      errors: result.errors,
      warnings: result.warnings,
    };
    io.stdout.write(`${JSON.stringify(safeResult, null, 2)}\n`);
    return;
  }
  for (const diagnostic of result.diagnostics || []) {
    const location = diagnostic.path ? ` ${diagnostic.path}` : "";
    io.stdout.write(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}: ${diagnostic.message}\n`);
  }
  io.stdout.write(result.valid ? "Target is valid.\n" : "Target is invalid.\n");
}

async function writeJsonAtomic(outputPath, value, { force = false } = {}) {
  const absolute = resolve(outputPath);
  if (existsSync(absolute) && !force) {
    throw new Error(`Refusing to overwrite existing file: ${absolute}`);
  }
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.aomk-${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    if (force && existsSync(absolute)) await rm(absolute);
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return absolute;
}

export async function main(argv = process.argv.slice(2), io = process) {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") {
    io.stdout.write(`${HELP}\n`);
    return EXIT.OK;
  }
  if (argv[0] === "--version" || argv[0] === "version") {
    io.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  }

  const command = argv[0];
  try {
    if (command === "reach") {
      const { positional, flags } = parseFlags(argv.slice(1));
      if (positional[0] !== "doctor" || positional.length !== 1) {
        throw new Error("Usage: aomk reach doctor [--json]");
      }
      const result = doctorAgentReach({ authorized: Boolean(flags["authorize-upstream"]) });
      if (flags.json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        io.stdout.write(`${result.code}: ${result.message || "Agent Reach doctor completed."}\n`);
        if (result.installHint) io.stdout.write(`Install explicitly: ${result.installHint}\n`);
      }
      return result.ok ? EXIT.OK : EXIT.UPSTREAM;
    }

    if (command === "codex") {
      const { positional, flags } = parseFlags(argv.slice(1));
      const allowedFlags = new Set(["force", "json", "skills-dir"]);
      const unknownFlags = Object.keys(flags).filter((name) => !allowedFlags.has(name));
      if (
        positional[0] !== "install" ||
        positional.length !== 1 ||
        !flags["skills-dir"] ||
        unknownFlags.length > 0
      ) {
        throw new Error(
          "Usage: aomk codex install --skills-dir <directory> [--force] [--json]",
        );
      }
      const result = await installCodexSkill({
        skillsDir: flags["skills-dir"],
        force: Boolean(flags.force),
      });
      if (flags.json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else io.stdout.write(`Codex skill ${result.status}: ${result.skillDir}\n`);
      return EXIT.OK;
    }

    if (command === "workspace") {
      const { positional, flags } = parseFlags(argv.slice(1));
      const allowedFlags = new Set(["intent", "json", "locale", "out", "policy", "profile"]);
      const unknownFlags = Object.keys(flags).filter((name) => !allowedFlags.has(name));
      if (
        positional[0] !== "init" ||
        positional.length !== 2 ||
        !flags.out ||
        unknownFlags.length > 0
      ) {
        throw new Error(
          "Usage: aomk workspace init <https-url> --out <directory> [--profile <candidate.json>] [--locale <code>] [--intent <intent>] [--policy <profile>] [--json]",
        );
      }
      const result = await initWorkspace({
        url: positional[1],
        outDir: flags.out,
        profilePath: flags.profile,
        locale: flags.locale,
        intent: flags.intent,
        policyProfile: flags.policy,
      });
      if (flags.json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else io.stdout.write(`Workspace ${result.reused ? "reused" : "initialized"}: ${result.workspaceDir}\n`);
      return EXIT.OK;
    }

    const { positional, flags } = parseFlags(argv.slice(1));
    if (command === "init") {
      if (positional.length !== 1 || !flags.out) {
        throw new Error("Usage: aomk init <slug> --out <target.json>");
      }
      const value = initTarget({
        slug: positional[0],
        companyName: flags.company,
        domain: flags.domain,
        locale: flags.locale,
        intent: flags.intent,
        policyProfile: flags.policy,
      });
      const outputPath = await writeJsonAtomic(flags.out, value, { force: Boolean(flags.force) });
      io.stdout.write(`${outputPath}\n`);
      return EXIT.OK;
    }

    if (command === "validate") {
      if (positional.length !== 1) throw new Error("Usage: aomk validate <target.json|-> [--json]");
      const result = validateTarget(await readTarget(positional[0], io.stdin));
      printDiagnostics(result, io, Boolean(flags.json));
      return result.valid ? EXIT.OK : EXIT.INVALID;
    }

    if (command === "render") {
      if (positional.length !== 1 || !flags.out) {
        throw new Error("Usage: aomk render <target.json|-> --out <directory> [--preview] [--force] [--json]");
      }
      const target = await readTarget(positional[0], io.stdin);
      const validation = validateTarget(target);
      if (!validation.valid) {
        printDiagnostics(validation, io, Boolean(flags.json));
        return EXIT.INVALID;
      }
      if (validation.warnings.length > 0 && !flags.preview) {
        const blockError = {
          severity: "error",
          code: "RENDER_WARNINGS_BLOCKED",
          path: "/",
          message: "Resolve validation warnings or use --preview for local review.",
        };
        printDiagnostics(
          {
            valid: false,
            diagnostics: [...validation.diagnostics, blockError],
            errors: [blockError],
            warnings: validation.warnings,
          },
          io,
          Boolean(flags.json),
        );
        return EXIT.INVALID;
      }
      const rendered = await renderTarget(validation.value, {
        outDir: resolve(flags.out),
        force: Boolean(flags.force),
        preview: Boolean(flags.preview),
        validation,
      });
      if (flags.json) io.stdout.write(`${JSON.stringify(rendered, null, 2)}\n`);
      else io.stdout.write(`Rendered ${rendered.publicDir || resolve(flags.out, "public")}\n`);
      return EXIT.OK;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      io.stderr.write(`JSON_PARSE_ERROR: ${error.message}\n`);
      return EXIT.INVALID;
    }
    const isUsage = /^(Usage:|Unknown command|Missing value)/.test(error.message);
    const code = isUsage ? "USAGE_ERROR" : error.code || "IO_ERROR";
    io.stderr.write(`${code}: ${error.message}\n`);
    return isUsage ? EXIT.USAGE : EXIT.IO;
  }
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) process.exitCode = await main();
