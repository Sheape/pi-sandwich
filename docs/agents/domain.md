# Domain Docs

How engineering skills consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at repo root. It points to each context's `CONTEXT.md`.
- **`docs/adr/`** for system-wide decisions.
- Relevant context's **`CONTEXT.md`** and **`docs/adr/`** directory.

If files don't exist, proceed silently. Domain-modeling skills create them lazily when terminology or decisions become established.

## File structure

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                       ← system-wide decisions
├── apps/
│   └── website/
│       ├── CONTEXT.md
│       └── docs/adr/               ← website decisions
└── packages/
    └── utils/
        ├── CONTEXT.md
        └── docs/adr/               ← utility-package decisions
```

## Use glossary vocabulary

When output names a domain concept—issue title, refactor proposal, hypothesis, or test name—use terms defined in relevant `CONTEXT.md`. Avoid synonyms rejected by its glossary.

Missing concepts may indicate invented language or a real domain-model gap. Reconsider or record the gap for `/domain-modeling`.

## Flag ADR conflicts

Surface conflicts instead of silently overriding decisions:

> _Contradicts ADR-0007 (event-sourced orders)—but worth reopening because…_
