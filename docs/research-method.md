# Research Method

## Target readiness score

Score each criterion from 0 (absent) to 2 (strong evidence):

1. recent public trigger;
2. visible commercial or operating workflow;
3. measurable potential effect;
4. at least three quality sources;
5. realistic AI mechanism with a human owner;
6. ability to create an honest public-data artifact;
7. fit with the candidate's demonstrated skills;
8. identifiable recipient role;
9. manageable privacy, regulatory, and brand risk;
10. hypothesis specific enough to fail the replacement test.

Use a full microsite at 16–20, a short email plus one-page brief at 12–15, and more research or STOP below 12.

## Agent Reach collection layer

Agent Reach is an optional router for public evidence. Its upstream doctor may inspect config, probe authenticated tools or external services, and register a skill, so run `aomk reach doctor --authorize-upstream --json` only after explicit authorization. Treat an active backend as routing guidance, not proof of live retrieval. Prefer official company pages, filings, public authorities, and original posts.

The product pins its tested contract to Agent Reach `v1.5.0`. Updating the capability layer is a deliberate maintenance task: review its release, rerun the doctor, then rerun this repository's tests. Do not silently install from `main` during a target workflow.

## Evidence ledger

Every source records:

- a stable ID;
- source type;
- title and URL;
- access date;
- a conservative support statement.

The support statement should include both the fact and its boundary. Example: “The company describes configurable equipment; this does not prove how incoming requests are qualified.”

## Workflow map

```text
input -> preparation -> expert decision -> operational result -> learning loop
```

The selected opportunity must name the relevant signal, hypothesis, missing evidence, AI preparation, human decision, metric, STOP rule, and source references.

## Falsification

Before rendering, answer:

- Why might this hypothesis be wrong?
- Which three to five internal questions would disprove it?
- What correction rate or quality failure is unacceptable?
- What would make the target a STOP rather than a pilot?
