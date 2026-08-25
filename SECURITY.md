# Security Policy

## Supported versions

Security fixes are applied to the latest released minor version while the project is pre-1.0.

## Reporting a vulnerability

Do not open a public issue for a vulnerability or exposed secret. Use GitHub's private vulnerability reporting for this repository when available, or contact the maintainer through the public profile linked from the repository owner.

Include the affected version, reproduction steps, impact, and a minimal proof. Do not include real prospect PII, credentials, tokens, private documents, or third-party customer data.

## Security boundary

The `init`, `validate`, and `render` commands perform local file reads and writes only. `reach doctor` refuses to run without `--authorize-upstream`. Pinned Agent Reach doctor may read its local config, probe authenticated tools and external services, and register or update its skill. AOMK reduces returned JSON to channel status and backend identifiers, but sanitizing output does not constrain upstream execution.

The kit never installs Agent Reach automatically, authenticates to email or CRM, adds analytics, publishes a site, or sends outreach.

Generated outreach is always draft-only. Users are responsible for reviewing sources, external data-egress rules, claims, applicable law, brand use, and the final publication or sending decision.
