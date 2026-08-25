# Releasing

1. Update `CHANGELOG.md` and package version together.
2. Run `npm ci`, `npm run check`, and `npm run pack:check` on a clean tree.
3. Review `npm pack --dry-run` and the public-data audit output.
4. Commit with `chore: release vX.Y.Z`, create an annotated `vX.Y.Z` tag (signed when signing is configured), and push it.
5. Create GitHub release notes from the changelog.

Do not publish to npm until registry provenance and trusted publishing are configured. Agent Reach compatibility changes require a dedicated pull request updating the pinned commit, fixture, adapter tests, documentation, and third-party notice.
