# Target Data Contract

`schema/target.schema.json` is the machine-readable contract. The CLI adds cross-reference and claim-safety checks that JSON Schema alone does not express.

## Required groups

- `campaign`: intent, target role, language, CTA length, and `noindex`.
- `candidate`: public professional identity, contact, profile, and proof links.
- `company`: name, domain, industry, geography, and recipient role.
- `sources`: dated public evidence and a conservative support statement.
- `signals`: observations linked to sources.
- `opportunities`: one to three falsifiable workflow hypotheses.
- `selectedOpportunityId`: exactly one flagship opportunity.
- `pilot`: a 30-day test on three to five anonymized examples.
- `site`: disclosure, CTA, unknowns, and illustrative artifact.
- `privateArtifacts.outreach`: one subject, draft body, and explicit opt-out; body plus opt-out totals 70–110 words.

## Evidence states

- `fact`: directly supported by a cited source.
- `inference`: a reasoned interpretation of sourced facts.
- `assumption`: a provisional input used to design a test.
- `unknown`: information unavailable from public evidence.

Do not relabel an inference as fact because it appears plausible or repeats across secondary sources.

## Opportunity score

Each field is an integer from 0–2:

- `evidence`
- `strategicProximity`
- `measurable`
- `feasible30Days`
- `candidateFit`
- `risk`

Opportunity score is the five positive fields minus `risk`. Target readiness is a separate ten-criterion score in `docs/research-method.md`.
