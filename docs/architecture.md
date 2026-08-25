# Architecture

The product separates agent reasoning from deterministic artifact production.

```text
Agent Reach (optional capability layer)
        |
        v
AI agent or human researcher
        |
        v
target.json  <---- schema/target.schema.json
        |
        +---- validate ----> errors / warnings
        |
        `---- allowlist compile
                    +------> public/index.html + robots.txt
                    `------> private/outreach.txt
                           + private/call-brief.txt
                           ` private/qa-report.json
```

## Portability

The portable core is:

1. a documented JSON contract;
2. standards-based JSON Schema validation and deterministic Node.js rendering;
3. observable CLI exit codes;
4. fictional fixtures and behavior tests.

`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `skill/SKILL.md` are thin instruction adapters. They may help an agent discover the workflow, but no adapter is required to validate or render a target.

## Trust boundary

The agent researches and proposes. The CLI checks structure and deterministic safety invariants. The renderer builds the public page from an explicit allowlist; it never serializes the input object into HTML. A human remains responsible for source quality, inference quality, brand use, publication, contact selection, legal review, and sending.

Normal rendering requires the validated target-screen decision `microsite`. `--preview` is the explicit exception for local review and adds a visible not-approved-for-publication banner.

The rendering CLI has no network client, credential handling, CRM integration, email sender, analytics, or hosting mutation. Its optional Agent Reach adapter runs version detection and, only with `--authorize-upstream`, upstream doctor. That doctor may inspect config, probe authenticated tools or external services, and register a skill; output sanitization is not an execution sandbox. Research commands remain visible agent actions under Agent Reach's channel rules.

Private human-review drafts use plain `.txt`, not rendered Markdown, so untrusted link/image syntax cannot trigger a preview fetch.

Agent Reach is not vendored. The integration is pinned and documented as an external MIT-licensed capability layer, so upstream updates can be reviewed independently of the deterministic artifact compiler.

## Extension points

- additional renderers reading the same validated object;
- industry-specific opportunity libraries without target facts;
- translations stored in target data;
- MCP tools that wrap local `validate` and `render` only;
- signed provenance or source snapshots in privacy-safe deployments.

Do not make a renderer, agent adapter, or plugin the source of truth. Contract changes require schema, validator, fixtures, documentation, and tests in one pull request.
