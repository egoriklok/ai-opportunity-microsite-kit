import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const PRODUCT_ID = "ai-opportunity-microsite-kit";
const OUTPUT_VERSION = 1;
const MARKER_FILE = ".aomk-output.json";
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function renderError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw renderError(`Cannot render: ${field} must be a non-empty string.`, "AOMK_INVALID_TARGET");
  }
  return value;
}

function requiredArray(value, field) {
  if (!Array.isArray(value)) {
    throw renderError(`Cannot render: ${field} must be an array.`, "AOMK_INVALID_TARGET");
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainLine(value) {
  return String(value).replace(/[\r\n\u2028\u2029]+/g, " ");
}

function safeHttpsUrl(value, field) {
  const raw = requiredString(value, field);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw renderError(`Cannot render: ${field} is not a valid URL.`, "AOMK_UNSAFE_URL");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw renderError(
      `Cannot render: ${field} must be an HTTPS URL without embedded credentials.`,
      "AOMK_UNSAFE_URL",
    );
  }

  return parsed.href;
}

function safeMailto(email) {
  const raw = requiredString(email, "candidate.contact.email");
  const asciiMailbox = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
  if (raw.length > 254 || !asciiMailbox.test(raw) || raw.includes("..")) {
    throw renderError(
      "Cannot render: candidate.contact.email is not safe for a mailto link.",
      "AOMK_UNSAFE_EMAIL",
    );
  }
  return `mailto:${encodeURIComponent(raw)}`;
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function resolveSlug(target, requestedSlug) {
  const inferred = slugify(target?.company?.name) || slugify(target?.company?.domain);
  const slug = requestedSlug === undefined ? inferred : requestedSlug;
  if (typeof slug !== "string" || !SAFE_SLUG.test(slug)) {
    throw renderError(
      "Cannot render: slug must be 1-64 lowercase ASCII letters, digits, or internal hyphens.",
      "AOMK_UNSAFE_SLUG",
    );
  }
  return slug;
}

// This is intentionally an allowlist, not a clone with fields removed. New schema
// fields stay private until they are deliberately added here.
function toPublicView(target) {
  const selected = requiredArray(target?.opportunities, "opportunities").find(
    (opportunity) => opportunity?.id === target?.selectedOpportunityId,
  );
  if (!selected) {
    throw renderError(
      "Cannot render: selectedOpportunityId does not reference an opportunity.",
      "AOMK_INVALID_TARGET",
    );
  }

  return {
    researchDate: requiredString(target.researchDate, "researchDate"),
    locale: requiredArray(target.campaign?.locales, "campaign.locales")[0] || "en",
    company: {
      name: requiredString(target.company?.name, "company.name"),
      domain: requiredString(target.company?.domain, "company.domain"),
      industry: requiredString(target.company?.industry, "company.industry"),
      geography: requiredString(target.company?.geography, "company.geography"),
    },
    candidate: {
      name: requiredString(target.candidate?.name, "candidate.name"),
      role: requiredString(target.candidate?.role, "candidate.role"),
      bio: requiredString(target.candidate?.bio, "candidate.bio"),
      locationTimezone: requiredString(
        target.candidate?.locationTimezone,
        "candidate.locationTimezone",
      ),
      email: requiredString(target.candidate?.contact?.email, "candidate.contact.email"),
      profileUrl: requiredString(
        target.candidate?.contact?.profileUrl,
        "candidate.contact.profileUrl",
      ),
      proofLinks: requiredArray(target.candidate?.proofLinks, "candidate.proofLinks").map(
        (link) => ({
          label: requiredString(link?.label, "candidate.proofLinks[].label"),
          url: requiredString(link?.url, "candidate.proofLinks[].url"),
        }),
      ),
    },
    sources: requiredArray(target.sources, "sources").map((source) => ({
      id: requiredString(source?.id, "sources[].id"),
      type: requiredString(source?.type, "sources[].type"),
      title: requiredString(source?.title, "sources[].title"),
      url: requiredString(source?.url, "sources[].url"),
      accessedAt: requiredString(source?.accessedAt, "sources[].accessedAt"),
      supports: requiredString(source?.supports, "sources[].supports"),
    })),
    signals: requiredArray(target.signals, "signals").map((signal) => ({
      id: requiredString(signal?.id, "signals[].id"),
      observation: requiredString(signal?.observation, "signals[].observation"),
      status: requiredString(signal?.status, "signals[].status"),
      sourceRefs: requiredArray(signal?.sourceRefs, "signals[].sourceRefs").map(String),
    })),
    opportunity: {
      id: requiredString(selected.id, "selected opportunity.id"),
      title: requiredString(selected.title, "selected opportunity.title"),
      hypothesis: requiredString(selected.hypothesis, "selected opportunity.hypothesis"),
      status: requiredString(selected.status, "selected opportunity.status"),
      whyItMayBeWrong: requiredString(
        selected.whyItMayBeWrong,
        "selected opportunity.whyItMayBeWrong",
      ),
      missingEvidence: requiredArray(
        selected.missingEvidence,
        "selected opportunity.missingEvidence",
      ).map(String),
      aiPrepares: requiredArray(selected.aiPrepares, "selected opportunity.aiPrepares").map(
        String,
      ),
      humanDecides: requiredString(
        selected.humanDecides,
        "selected opportunity.humanDecides",
      ),
      practicalResult: requiredString(
        selected.practicalResult,
        "selected opportunity.practicalResult",
      ),
      metric: requiredString(selected.metric, "selected opportunity.metric"),
      stopRule: requiredString(selected.stopRule, "selected opportunity.stopRule"),
      evidenceRefs: requiredArray(
        selected.evidenceRefs,
        "selected opportunity.evidenceRefs",
      ).map(String),
    },
    pilot: {
      durationDays: target.pilot?.durationDays,
      sampleMin: target.pilot?.sampleMin,
      sampleMax: target.pilot?.sampleMax,
      steps: requiredArray(target.pilot?.steps, "pilot.steps").map(String),
      decision: requiredArray(target.pilot?.decision, "pilot.decision").map(String),
    },
    site: {
      title: requiredString(target.site?.title, "site.title"),
      disclosure: requiredString(target.site?.disclosure, "site.disclosure"),
      cta: requiredString(target.site?.cta, "site.cta"),
      unknowns: requiredArray(target.site?.unknowns, "site.unknowns").map(String),
      artifact: {
        title: requiredString(target.site?.artifact?.title, "site.artifact.title"),
        label: requiredString(target.site?.artifact?.label, "site.artifact.label"),
        fields: requiredArray(target.site?.artifact?.fields, "site.artifact.fields").map(
          (field) => ({
            name: requiredString(field?.name, "site.artifact.fields[].name"),
            value: requiredString(field?.value, "site.artifact.fields[].value"),
          }),
        ),
      },
    },
  };
}

function list(items, renderItem, className = "") {
  return `<ul${className ? ` class="${className}"` : ""}>${items.map(renderItem).join("")}</ul>`;
}

function renderPublicHtml(view, preview = false) {
  const profileUrl = safeHttpsUrl(view.candidate.profileUrl, "candidate.contact.profileUrl");
  const emailUrl = safeMailto(view.candidate.email);
  const proofLinks = view.candidate.proofLinks.map((link, index) => ({
    label: link.label,
    url: safeHttpsUrl(link.url, `candidate.proofLinks[${index}].url`),
  }));
  const sources = view.sources.map((source, index) => ({
    ...source,
    url: safeHttpsUrl(source.url, `sources[${index}].url`),
  }));
  const lang = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(view.locale) ? view.locale : "en";

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(view.site.title)}</title>
  <style>
    :root { color-scheme: light; --ink: #17211b; --muted: #58645d; --line: #dce4df; --paper: #fbfcfb; --accent: #176b4a; --wash: #edf5f0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
    main { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; padding: 3rem 0 5rem; }
    header, section { border-bottom: 1px solid var(--line); padding: 2.25rem 0; }
    h1 { max-width: 19ch; font-size: clamp(2.25rem, 6vw, 4.8rem); line-height: .98; letter-spacing: -.05em; margin: .5rem 0 1.25rem; }
    h2 { font-size: clamp(1.45rem, 3vw, 2.25rem); line-height: 1.15; margin: 0 0 1rem; }
    h3 { margin-bottom: .35rem; }
    p { max-width: 72ch; }
    a { color: var(--accent); text-underline-offset: .18em; }
    .eyebrow, .status { color: var(--accent); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .disclosure { max-width: 78ch; color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 1rem; }
    .card { border: 1px solid var(--line); border-radius: .8rem; padding: 1.1rem; background: white; }
    .card p:last-child { margin-bottom: 0; }
    .meta { color: var(--muted); font-size: .92rem; }
    .artifact { background: var(--wash); border: 1px solid #cbded2; border-radius: 1rem; padding: 1.4rem; }
    .artifact dl { display: grid; grid-template-columns: minmax(8rem, .55fr) 1fr; gap: .55rem 1rem; }
    .artifact dt { font-weight: 700; }
    .artifact dd { margin: 0; }
    .cta { border: 1px solid var(--accent); border-radius: 1rem; padding: 1.5rem; background: #f5faf7; }
    .links { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; padding: 0; list-style: none; }
    .preview { border: 2px solid #9a6700; border-radius: .8rem; padding: .8rem 1rem; color: #5f3f00; background: #fff8df; font-weight: 700; }
    footer { color: var(--muted); padding-top: 2rem; font-size: .92rem; }
    @media (max-width: 36rem) { .artifact dl { grid-template-columns: 1fr; } .artifact dd { margin-bottom: .65rem; } }
  </style>
</head>
<body>
<main>
  ${preview ? '<p class="preview" role="status">PREVIEW — this target is not approved for publication.</p>' : ""}
  <header>
    <p class="eyebrow">Independent, evidence-led work sample</p>
    <h1>${escapeHtml(view.site.title)}</h1>
    <p class="disclosure">${escapeHtml(view.site.disclosure)}</p>
    <p class="meta">Research date: ${escapeHtml(view.researchDate)} · ${escapeHtml(view.company.industry)} · ${escapeHtml(view.company.geography)}</p>
  </header>

  <section aria-labelledby="evidence-title">
    <h2 id="evidence-title">What the public evidence supports</h2>
    <div class="grid">${view.signals
      .map(
        (signal) => `<article class="card">
      <p class="status">${escapeHtml(signal.status)} · ${escapeHtml(signal.id)}</p>
      <p>${escapeHtml(signal.observation)}</p>
      <p class="meta">Sources: ${escapeHtml(signal.sourceRefs.join(", "))}</p>
    </article>`,
      )
      .join("")}</div>
  </section>

  <section aria-labelledby="hypothesis-title">
    <p class="status">${escapeHtml(view.opportunity.status)} · ${escapeHtml(view.opportunity.id)}</p>
    <h2 id="hypothesis-title">${escapeHtml(view.opportunity.title)}</h2>
    <p>${escapeHtml(view.opportunity.hypothesis)}</p>
    <div class="grid">
      <article class="card"><h3>AI prepares</h3>${list(view.opportunity.aiPrepares, (item) => `<li>${escapeHtml(item)}</li>`)}</article>
      <article class="card"><h3>A human decides</h3><p>${escapeHtml(view.opportunity.humanDecides)}</p></article>
      <article class="card"><h3>Practical result</h3><p>${escapeHtml(view.opportunity.practicalResult)}</p></article>
    </div>
    <h3>Why this may be wrong</h3>
    <p>${escapeHtml(view.opportunity.whyItMayBeWrong)}</p>
    <h3>Evidence still missing</h3>
    ${list(view.opportunity.missingEvidence, (item) => `<li>${escapeHtml(item)}</li>`)}
  </section>

  <section aria-labelledby="artifact-title">
    <div class="artifact">
      <p class="status">${escapeHtml(view.site.artifact.label)}</p>
      <h2 id="artifact-title">${escapeHtml(view.site.artifact.title)}</h2>
      <dl>${view.site.artifact.fields
        .map(
          (field) => `<dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(field.value)}</dd>`,
        )
        .join("")}</dl>
    </div>
  </section>

  <section aria-labelledby="pilot-title">
    <h2 id="pilot-title">A bounded ${escapeHtml(view.pilot.durationDays)}-day test</h2>
    <p>Sample: ${escapeHtml(view.pilot.sampleMin)}–${escapeHtml(view.pilot.sampleMax)} cases.</p>
    ${list(view.pilot.steps, (step) => `<li>${escapeHtml(step)}</li>`)}
    <div class="grid">
      <article class="card"><h3>Metric</h3><p>${escapeHtml(view.opportunity.metric)}</p></article>
      <article class="card"><h3>Stop rule</h3><p>${escapeHtml(view.opportunity.stopRule)}</p></article>
      <article class="card"><h3>Decision</h3><p>${escapeHtml(view.pilot.decision.join(" / "))}</p></article>
    </div>
  </section>

  <section aria-labelledby="unknowns-title">
    <h2 id="unknowns-title">Unknowns to resolve before implementation</h2>
    ${list(view.site.unknowns, (item) => `<li>${escapeHtml(item)}</li>`)}
  </section>

  <section aria-labelledby="sources-title">
    <h2 id="sources-title">Sources</h2>
    <div class="grid">${sources
      .map(
        (source) => `<article class="card">
      <p class="status">${escapeHtml(source.type)} · ${escapeHtml(source.id)}</p>
      <h3><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a></h3>
      <p>${escapeHtml(source.supports)}</p>
      <p class="meta">Accessed ${escapeHtml(source.accessedAt)}</p>
    </article>`,
      )
      .join("")}</div>
  </section>

  <section aria-labelledby="candidate-title">
    <h2 id="candidate-title">Who prepared this</h2>
    <p><strong>${escapeHtml(view.candidate.name)}</strong> · ${escapeHtml(view.candidate.role)}</p>
    <p>${escapeHtml(view.candidate.bio)}</p>
    <p class="meta">${escapeHtml(view.candidate.locationTimezone)}</p>
    <ul class="links">
      <li><a href="${escapeHtml(profileUrl)}" rel="noopener noreferrer">Profile</a></li>
      ${proofLinks
        .map(
          (link) => `<li><a href="${escapeHtml(link.url)}" rel="noopener noreferrer">${escapeHtml(link.label)}</a></li>`,
        )
        .join("")}
    </ul>
  </section>

  <section>
    <div class="cta">
      <h2>A small next step</h2>
      <p>${escapeHtml(view.site.cta)}</p>
      <p><a href="${escapeHtml(emailUrl)}">Email ${escapeHtml(view.candidate.name)}</a></p>
    </div>
  </section>

  <footer>
    <p>This page is public if hosted. The robots directive is a crawler request, not access control.</p>
  </footer>
</main>
</body>
</html>
`;
}

function renderOutreach(target) {
  const outreach = target?.privateArtifacts?.outreach;
  const subject = requiredString(outreach?.subject, "privateArtifacts.outreach.subject").replace(
    /[\r\n]+/g,
    " ",
  );
  const body = requiredString(outreach?.body, "privateArtifacts.outreach.body").replace(
    /\r\n?/g,
    "\n",
  );
  const optOut = requiredString(
    outreach?.optOut,
    "privateArtifacts.outreach.optOut",
  ).replace(/[\r\n\u2028\u2029]+/g, " ");
  return `OUTREACH DRAFT\n\nSUBJECT: ${subject}\n\n${body}\n\nOPT-OUT: ${optOut}\n`;
}

function renderCallBrief(target) {
  const selected = target.opportunities.find(
    (opportunity) => opportunity.id === target.selectedOpportunityId,
  );
  return `CALL BRIEF: ${plainLine(target.company.name)}\n\n` +
    `Recipient role: ${plainLine(target.company.recipientRole)}\n` +
    `Candidate intent: ${plainLine(target.campaign.intent)}\n` +
    `Proposed duration: ${plainLine(target.campaign.ctaMinutes)} minutes\n` +
    `Selected hypothesis: ${plainLine(selected.title)}\n` +
    `Target-screen decision: ${plainLine(target.targetScreen.decision)} (${plainLine(target.targetScreen.total)}/20)\n\n` +
    `QUESTIONS TO RESOLVE\n\n` +
    target.site.unknowns.map((item) => `- ${plainLine(item)}`).join("\n") +
    `\n\nGUARDRAIL\n\nDo not present an inference as a confirmed internal fact.\n`;
}

function renderQaReport(target, slug, validation, preview) {
  const selected = target.opportunities.find(
    (opportunity) => opportunity.id === target.selectedOpportunityId,
  );
  return `${JSON.stringify(
    {
      product: PRODUCT_ID,
      outputVersion: OUTPUT_VERSION,
      slug,
      schemaVersion: target.schemaVersion,
      researchDate: target.researchDate,
      company: target.company.name,
      targetScreen: target.targetScreen,
      selectedOpportunity: {
        id: selected.id,
        title: selected.title,
        evidenceRefs: selected.evidenceRefs,
      },
      counts: {
        sources: target.sources.length,
        signals: target.signals.length,
        opportunities: target.opportunities.length,
      },
      publicBoundary: {
        excludes: ["company.recipientRole", "targetScreen", "privateArtifacts"],
      },
      renderMode: preview ? "preview" : "microsite",
      validation: validation
        ? {
            valid: validation.valid === true,
            diagnostics: (validation.diagnostics || []).map(
              ({ severity, code, path, message }) => ({ severity, code, path, message }),
            ),
          }
        : { performed: false },
    },
    null,
    2,
  )}\n`;
}

function markerContent(slug) {
  return `${JSON.stringify(
    {
      product: PRODUCT_ID,
      outputVersion: OUTPUT_VERSION,
      slug,
    },
    null,
    2,
  )}\n`;
}

async function pathState(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function verifyManagedOutput(outputPath, slug) {
  const outputStat = await pathState(outputPath);
  if (!outputStat?.isDirectory() || outputStat.isSymbolicLink()) {
    throw renderError(
      "Refusing --force: existing output is not a regular product directory.",
      "AOMK_UNSAFE_OUTPUT",
    );
  }

  const markerPath = path.join(outputPath, MARKER_FILE);
  const markerStat = await pathState(markerPath);
  if (!markerStat?.isFile() || markerStat.isSymbolicLink()) {
    throw renderError(
      `Refusing --force: ${MARKER_FILE} is missing or unsafe.`,
      "AOMK_MARKER_MISMATCH",
    );
  }

  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw renderError(
      `Refusing --force: ${MARKER_FILE} is not valid JSON.`,
      "AOMK_MARKER_MISMATCH",
    );
  }

  if (
    marker.product !== PRODUCT_ID ||
    marker.outputVersion !== OUTPUT_VERSION ||
    marker.slug !== slug
  ) {
    throw renderError(
      "Refusing --force: output marker does not match this product and target slug.",
      "AOMK_MARKER_MISMATCH",
    );
  }
}

async function writeTree(root, files) {
  for (const [relativePath, content] of files) {
    const destination = path.join(root, ...relativePath.split("/"));
    const relative = path.relative(root, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw renderError("Refusing to write outside the output directory.", "AOMK_OUTPUT_ESCAPE");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
  }
}

/**
 * Render a validated target into a public microsite and private operator files.
 *
 * @param {object} target
 * @param {{outDir: string, force?: boolean, preview?: boolean, slug?: string}} options
 * @returns {Promise<{outDir: string, slug: string, files: string[]}>}
 */
export async function renderTarget(target, options = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw renderError("Cannot render: target must be an object.", "AOMK_INVALID_TARGET");
  }
  if (typeof options.outDir !== "string" || options.outDir.trim() === "") {
    throw renderError("Cannot render: options.outDir is required.", "AOMK_INVALID_OUTPUT");
  }
  if (target?.targetScreen?.decision !== "microsite" && options.preview !== true) {
    throw renderError(
      "Target is not approved for a public microsite. Use preview mode only for local review.",
      "AOMK_TARGET_NOT_READY",
    );
  }
  if (
    options.validation &&
    (options.validation.valid !== true ||
      (!options.preview &&
        Array.isArray(options.validation.warnings) &&
        options.validation.warnings.length > 0))
  ) {
    throw renderError(
      "Validated target has blocking errors or warnings. Use preview mode only for warning review.",
      "AOMK_VALIDATION_BLOCKED",
    );
  }

  const slug = resolveSlug(target, options.slug);
  const requestedOutput = path.resolve(options.outDir);
  if (requestedOutput === path.parse(requestedOutput).root) {
    throw renderError("Refusing to use a filesystem root as output.", "AOMK_UNSAFE_OUTPUT");
  }

  await mkdir(path.dirname(requestedOutput), { recursive: true });
  const realParent = await realpath(path.dirname(requestedOutput));
  const outputPath = path.join(realParent, path.basename(requestedOutput));
  const existing = await pathState(outputPath);

  if (existing && !options.force) {
    throw renderError(
      `Output already exists: ${outputPath}. Use --force only for a matching managed output.`,
      "AOMK_OUTPUT_EXISTS",
    );
  }
  if (existing) await verifyManagedOutput(outputPath, slug);

  const publicView = toPublicView(target);
  const files = [
    ["public/index.html", renderPublicHtml(publicView, options.preview === true)],
    ["public/robots.txt", "User-agent: *\nDisallow: /\n"],
    ["private/outreach.txt", renderOutreach(target)],
    ["private/call-brief.txt", renderCallBrief(target)],
    [
      "private/qa-report.json",
      renderQaReport(target, slug, options.validation, options.preview === true),
    ],
    [MARKER_FILE, markerContent(slug)],
  ];

  const tempPath = await mkdtemp(
    path.join(realParent, `.${path.basename(outputPath)}.aomk-tmp-`),
  );
  let backupPath;
  try {
    await writeTree(tempPath, files);
    if (existing) {
      backupPath = path.join(
        realParent,
        `.${path.basename(outputPath)}.aomk-backup-${randomUUID()}`,
      );
      await rename(outputPath, backupPath);
      try {
        await rename(tempPath, outputPath);
      } catch (error) {
        await rename(backupPath, outputPath);
        backupPath = undefined;
        throw error;
      }
      await rm(backupPath, { recursive: true, force: false });
      backupPath = undefined;
    } else {
      await rename(tempPath, outputPath);
    }
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    if (backupPath) {
      const outputAfterFailure = await pathState(outputPath);
      if (!outputAfterFailure) await rename(backupPath, outputPath);
    }
    throw error;
  }

  return {
    outDir: outputPath,
    slug,
    files: files.map(([relativePath]) => relativePath),
  };
}
