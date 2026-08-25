# AI Opportunity Microsite Kit

[![CI](https://github.com/egoriklok/ai-opportunity-microsite-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/egoriklok/ai-opportunity-microsite-kit/actions/workflows/ci.yml)

An agent-agnostic toolkit for turning public company evidence into a personalized proof-of-work microsite, a draft-only outreach message, and a short validation-call brief.

The kit is designed for job seekers, operators, and consultants who want to demonstrate how they think about one real company workflow without pretending to know the company from the inside.

## What makes it different

- **Evidence before AI:** every material claim points to a dated source.
- **One opportunity:** the output selects one flagship workflow, not a catalogue of AI ideas.
- **Human authority:** every proposal separates what AI prepares from what a person decides.
- **Falsifiable:** each target has missing evidence, one metric, and a STOP rule.
- **Portable:** agents exchange one JSON document validated by a small Node.js CLI.
- **Safe by default:** generated sites use `noindex, nofollow`, contain no tracking, and outreach remains draft-only.
- **Internet-capable:** optional [Agent Reach](https://github.com/Panniantong/Agent-Reach) integration gives shell-capable agents sanitized, version-pinned upstream route status for public research.

## One URL, one isolated Codex project

The recommended operating model is **one prospective customer = one new workspace**. Keep the framework as a pinned dependency; never mix a new target with the framework checkout or another customer's files.

After a one-time private candidate profile is saved at `~/.codex/aomk/candidate-profile.json`, open an empty customer folder in Codex and paste one prompt containing the company URL. The agent can install the pinned kit, perform public research, build and validate `target.json`, render a local preview, inspect it, and report evidence gaps. It must not invent identity fields.

Copy-ready Russian and English prompts, the private profile shape, one-time skill installation, and the expected outputs are in [docs/codex-one-prompt.md](./docs/codex-one-prompt.md). Those prompts explicitly request a Codex goal. The skill does not create a formal goal when the user has not requested one.

The one-prompt default authorizes only public research and local preview files. Publishing, sending, contacting anyone, external drafts, CRM access, contact enrichment, and Agent Reach each require a later, separate, explicit approval.

## Quick start

Requirements: Node.js 20 or newer and npm.

```bash
git clone https://github.com/egoriklok/ai-opportunity-microsite-kit.git
cd ai-opportunity-microsite-kit
npm ci
npm test

node ./src/cli.mjs init acme --out ./targets/acme/target.json
node ./src/cli.mjs validate ./targets/acme/target.json
node ./src/cli.mjs render ./targets/acme/target.json --out ./dist/acme --preview
```

To consume the reviewed GitHub version without cloning:

```bash
npm install --save-dev github:egoriklok/ai-opportunity-microsite-kit#v0.2.0
npx aomk codex install --skills-dir "$HOME/.codex/skills" --json
npx aomk --help
```

Inside an empty, customer-specific workspace, the agent uses the scaffold command below before research:

```bash
npx aomk workspace init https://example.com --out . --profile "$HOME/.codex/aomk/candidate-profile.json" --locale en --intent collaboration --policy collaboration-cold-v1 --json
```

`workspace init` is scaffold-only: it never researches, validates, renders, publishes, sends, initializes Git, or calls Agent Reach.

For multi-channel public research, install Agent Reach separately and explicitly. The kit is tested against `v1.5.0`; it never installs or configures Agent Reach itself.

```bash
pipx install "git+https://github.com/Panniantong/Agent-Reach.git@f65526cbaaad3879473acc1ba6dbefd195caf2be"
node ./src/cli.mjs reach doctor --authorize-upstream
```

The authorization flag is deliberate: pinned Agent Reach `doctor` may read its local config, probe authenticated tools and external services, and register or update its agent skill. AOMK sanitizes the returned JSON, but it cannot make upstream execution credential-free or mutation-free. Reported status is routing guidance, not proof that a later retrieval will succeed.

Agent Reach is the optional internet capability layer. This kit is the evidence, validation, and rendering workflow. See [docs/agent-reach.md](./docs/agent-reach.md).

Agent Reach is an independent MIT-licensed project. This integration does not imply affiliation or endorsement.

Open `dist/acme/public/index.html` locally after replacing every illustrative field with sourced target-specific content. Only `public/` is publishable. `private/` contains review artifacts and must remain local.

`render` refuses targets below the `microsite` threshold. During drafting, use `--preview`; the generated page carries a visible not-approved-for-publication banner.

`validate --json` emits diagnostics only. It never echoes the target, candidate email, or private outreach into logs.

## Agent workflow

Agents should read [skill/SKILL.md](./skill/SKILL.md). For a URL-only Codex run, they must also read [skill/references/one-prompt-workflow.md](./skill/references/one-prompt-workflow.md). The core sequence is:

```text
target screen
  -> evidence ledger
  -> workflow map
  -> 1–3 scored opportunities
  -> one flagship hypothesis
  -> target.json
  -> validate
  -> render
  -> human review
  -> optional manual outreach
```

The repository includes thin instruction adapters for tools that look for `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. The data contract and CLI remain the source of portability; adapters do not change the method.

## Generated artifacts

`render` creates:

- `public/index.html` — responsive, self-contained microsite;
- `public/robots.txt` — indexing discouragement for compatible crawlers;
- `private/outreach.txt` — one inert, draft-only message;
- `private/call-brief.txt` — an inert 15-minute reality check;
- `private/qa-report.json` — validation result and target summary.

No message is sent, no CRM is updated, no visitor data is collected, and no external API is called. `noindex` is not access control: anyone with a hosted public URL may still view it.

## Target readiness

Create a full microsite only when the target scores 16–20 across the ten criteria in [docs/research-method.md](./docs/research-method.md). A score of 12–15 calls for a short email plus one-page brief. Below 12, close the evidence gap or skip the target.

## Public-data boundary

This repository ships only with the fictional `NordForm Machines` fixture. Never commit real prospect contact data, private research notes, credentials, analytics identifiers, customer documents, or generated target folders. Read [docs/privacy-and-claims.md](./docs/privacy-and-claims.md) before publishing an output.

## Project status

`0.2.0` is an early public release. The JSON contract and CLI behavior may evolve before `1.0.0`; changes will be documented in releases.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md). The project is available under the [MIT License](./LICENSE).
