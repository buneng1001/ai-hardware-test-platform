# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root
- `docs/adr/` entries that touch the area being changed

If any of these files do not exist, proceed silently. Domain documentation is created lazily when terms or decisions are resolved.

## File structure

This repo uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use domain terms exactly as defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether it belongs or record the gap for later domain modeling.

## Flag ADR conflicts

If proposed work contradicts an ADR, surface the conflict explicitly instead of silently overriding the decision.

