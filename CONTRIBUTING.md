# Contributing

Contributions are welcome when they improve portability, evidence quality, validation, accessibility, or privacy without turning the project into a bulk-outreach system.

## Development

1. Fork the repository and create a focused branch.
2. Use Node.js 20 or newer.
3. Make the smallest coherent change.
4. Add or update behavior-focused tests.
5. Run `npm run check` and `npm run pack:check`.
6. Open a pull request describing user-visible behavior, evidence, and privacy impact.

Use concise Conventional Commit subjects, for example:

```text
feat: add a second static renderer
fix: reject missing source dates
docs: clarify target scoring
```

## Pull requests

Include:

- the problem and intended user outcome;
- verification performed;
- screenshots for visual changes;
- schema compatibility impact;
- any new data, privacy, or outreach risk.

Never include real prospect data, credentials, private research, production analytics, or unlicensed customer branding in issues, fixtures, tests, or screenshots.

Agent Reach compatibility updates must pin a full upstream commit and update the compatibility manifest, sanitized doctor fixture, adapter tests, documentation, and third-party notice in the same pull request. Never add live authenticated-channel tests to default CI.
