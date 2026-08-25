import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipped = new Set([".git", "node_modules", "dist", "coverage"]);
const markdown = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && entry.name.endsWith(".md")) markdown.push(absolute);
  }
}

await walk(root);
const failures = [];
for (const file of markdown) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/\[[^\]]*\]\((\.\.?\/[^)#?]+)(?:#[^)]+)?\)/g)) {
    const target = resolve(dirname(file), decodeURIComponent(match[1]));
    const rel = relative(root, target);
    if (rel.startsWith("..") || resolve(root, rel) !== target) {
      failures.push(`${relative(root, file)} -> path escapes repository`);
      continue;
    }
    try {
      await access(target);
    } catch {
      failures.push(`${relative(root, file)} -> ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`DOC_LINK ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${markdown.length} Markdown files.`);
}
