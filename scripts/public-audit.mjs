import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const self = resolve(fileURLToPath(import.meta.url));
const skipped = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  "", ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".toml", ".txt", ".yaml", ".yml",
]);
const decode = (value) => Buffer.from(value, "base64").toString("utf8");

const forbiddenText = [
  ["private project name", decode("U1RPQ0g=")],
  ["private project domain", decode("c3RvY2gtY25j")],
  ["private hosting domain", decode("Y2hhdGdwdC5zaXRl")],
  ["Windows user path", decode("QzpcVXNlcnNc")],
  ["WSL user path", decode("L2hvbWUvZWdvcmk=")],
  ["private platform project id", decode("YXBwZ3Byal8=")],
];
const secretPatterns = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const forbiddenNames = [
  ["private memory artifact", new RegExp(decode("aG9uY2hv"), "i")],
  ["private target artifact", new RegExp(decode("c3RvY2g="), "i")],
];

async function walk(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (skipped.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in public package: ${relative(root, absolute)}`);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function auditPublicTree(scanRoot = root) {
  const resolvedRoot = resolve(scanRoot);
  const findings = [];
  for (const file of await walk(resolvedRoot)) {
    const rel = relative(resolvedRoot, file).replaceAll("\\", "/");
    for (const [label, pattern] of forbiddenNames) {
      pattern.lastIndex = 0;
      if (pattern.test(rel)) findings.push({ file: rel, rule: label });
    }
    if (resolve(file) === self || !textExtensions.has(extname(file).toLowerCase())) continue;
    const stats = await lstat(file);
    if (stats.size > 2 * 1024 * 1024) {
      findings.push({ file: rel, rule: "unexpected large text file" });
      continue;
    }
    const buffer = await readFile(file);
    if (buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    for (const [label, needle] of forbiddenText) {
      if (text.toLowerCase().includes(needle.toLowerCase())) findings.push({ file: rel, rule: label });
    }
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) findings.push({ file: rel, rule: label });
    }
    if (extname(file).toLowerCase() === ".json") {
      try {
        JSON.parse(text);
      } catch {
        findings.push({ file: rel, rule: "invalid JSON" });
      }
    }
  }
  return findings;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === self;
if (isDirect) {
  const findings = await auditPublicTree();
  if (findings.length > 0) {
    for (const finding of findings) console.error(`PUBLIC_AUDIT ${finding.rule}: ${finding.file}`);
    process.exitCode = 1;
  } else {
    console.log("Public audit passed: no forbidden project data or obvious secrets found.");
  }
}
