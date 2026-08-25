# Agent Reach Adapter

This adapter checks a separately installed, commit-pinned Agent Reach capability layer. It invokes only fixed, shell-free commands:

```text
agent-reach version
agent-reach doctor --json  # only after --authorize-upstream at the AOMK boundary
```

Only channel name, normalized status, and a safe active-backend identifier survive sanitization. Messages, paths, environment values, cookies, tokens, proxies, and raw results are never returned or stored.

Sanitized output does not make upstream execution read-only: doctor may inspect local config, probe authenticated tools or external services, and register a skill. The adapter refuses doctor execution until authority is explicit.

The adapter refuses an untested Agent Reach version. To upgrade, change `compatibility.json`, the constants in `src/lib/agent-reach.mjs`, the fixture, tests, documentation, and third-party notice together.
