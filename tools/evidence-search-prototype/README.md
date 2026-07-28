# Evidence-search contract prototype

> **THROWAWAY PROTOTYPE — do not ship this code.**

## Question

Does a case-sensitive literal `sandwich_evidence_search` contract feel understandable and safe when it verifies evidence before matching, returns one exact match per record, bounds both result count and scanning work, exposes corruption, and resumes with a cursor?

The prototype uses seven in-memory records covering ordinary success, failed output, the same literal from different tools, repeated matches in one record, an intentionally corrupted record, image-only evidence, filters, no matches, result-limit pagination, and scan-budget pagination. Its JSON encoding only stands in for the separately versioned canonical envelope; this prototype does not decide canonical framing or persistence.

## Run

```sh
vp run prototype:evidence-search
```

## Controls

- `1`–`5`: choose a dummy search scenario
- `s`: continue from the returned cursor
- `r`: restart the current search
- `t`: cycle the tool-name filter
- `e`: cycle the error-status filter
- `l`: cycle the result limit
- `b`: cycle the internal record-scan budget
- `q`: quit

For a non-interactive dump of every scenario:

```sh
node tools/evidence-search-prototype/tui.ts --demo
```
