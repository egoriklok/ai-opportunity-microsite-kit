# Claude Instructions

Read and follow `skill/SKILL.md` for every target-research or microsite-generation task. Use `schema/target.schema.json` as the data contract and the CLI for deterministic validation and rendering. Keep outreach draft-only unless the user separately authorizes sending.

Use Agent Reach only as an optional public-evidence capability layer. Run `aomk reach doctor --authorize-upstream --json` only after explicit authorization because upstream doctor may inspect config, probe authenticated tools or the network, and register a skill.
