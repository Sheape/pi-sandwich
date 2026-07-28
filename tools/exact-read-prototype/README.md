# Exact repeated-read identity prototype

> **THROWAWAY PROTOTYPE — not production code**

## Question

Does a state model that always executes the current read, requires the same normalized read selection, compares the complete canonical Pi-visible payload identity, and commits exact evidence for the current tool call safely replace repeated output without stale-reference substitution?

The prototype treats a **read observation** as the Pi-visible result returned by one completed `read` call. It does not claim that the file remains unchanged after that call or that truncated-away file content was observed.

## Run

```sh
vp run prototype:exact-read
```

Advance each scenario one check at a time with Space, or press `a` to resolve it immediately. The scenarios cover first reads, relative/absolute paths, symlinks, line ranges, truncation, same-stat content changes, formatting, generation, atomic replacement, deletion/recreation, checkout/reset, images, invalid UTF-8 decoding, unsupported byte-range producers, evidence failure, and edits racing after a completed read.

## Deliberate limits

- In-memory dummy observations only; no filesystem or evidence-store writes.
- The canonicalizer is sufficient for the prototype's JSON fixtures, not an RFC 8785 implementation.
- Filesystem stat data is displayed to demonstrate why it is never authoritative.
- The latest successful observation is the only baseline for a selection.
