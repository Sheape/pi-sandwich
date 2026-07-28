# Exact repeated-read identity and invalidation

**Status:** Accepted working decision for **Define exact repeated-read identity and invalidation**

## Decision

Sandwich may replace a repeated `read` result only after the underlying read has executed normally and the new Pi-visible result exactly matches the latest successful observation of the same read selection. Filesystem metadata and write notifications never authorize substitution.

The feature reduces repeated model-context output. It is not a filesystem read cache and never skips tool execution.

## Canonical terms

- **Read observation:** the complete Pi-visible content blocks returned by one finished `read` call. It does not include bytes discarded before Pi's `tool_result` hook and makes no claim about filesystem state after the call.
- **Read selection:** the pinned producer contract, lexical absolute path, and normalized line-range input identifying what was requested.
- **Payload identity:** the existing evidence-protocol tuple `{ canonicalizationVersion, byteLength, sha256 }` over the versioned canonical ordered content blocks.
- **Observation ledger:** the bounded, branch-local, process-memory-only table containing the latest successful payload identity and tool-call ID for each read selection.
- **Exact-repeat candidate:** a successful fresh read whose selection and payload identity equal the ledger baseline available at turn start.

## Identity tuple

```ts
{
  selection: {
    schema: "sandwich-read-selection/v1",
    producerContract: "pi-read/<pinned-version>",
    lexicalAbsolutePath: resolve(cwd, input.path),
    offset: input.offset ?? 1,
    limit: input.limit ?? null
  },
  payload: {
    canonicalizationVersion: 1,
    byteLength,
    sha256
  }
}
```

`lexicalAbsolutePath` is private internal state. It never enters the model-visible marker, evidence URI, receipt, or telemetry.

Lexical resolution deliberately:

- unifies relative and absolute spellings resolving to the same path;
- does not call `realpath` or inspect inode/device identity;
- treats direct paths and symlink aliases as different selections;
- keeps the same selection when one symlink path is retargeted;
- remains case-sensitive and therefore conservatively misses aliases on case-insensitive filesystems.

The producer contract pins the meaning of `path`, `offset`, `limit`, UTF-8 decoding, image processing, and tool-local truncation. An unrecognized producer—including a byte-range reader—fails open until it defines a separate pinned selection contract.

## Protocol

1. At assistant-turn start, freeze the eligible observation ledger. Reads completing in the current turn cannot become baselines for sibling reads.
2. Execute the underlying `read` normally. Never return a pre-execution cache hit.
3. Preserve errors unchanged. Errors do not replace the latest successful baseline.
4. Reject unrecognized producer contracts unchanged.
5. Construct the private read-selection identity from the current cwd and exact normalized input.
6. Canonicalize the complete ordered Pi-visible content blocks with the evidence protocol and compute payload byte length and SHA-256.
7. If no eligible baseline exists, the selection differs, or the payload tuple differs, return the complete current result unchanged.
8. If selection and payload match, stage the complete **current** canonical evidence envelope. Read it back, verify it, validate the compact presentation, then commit and pin it under the immutable fail-open contract.
9. If any current-evidence or presentation step fails, return the complete current result unchanged.
10. On success, insert:

```text
[Sandwich: selected Pi-visible read result exactly matches latest successful observation <toolCallId>.]
[Sandwich: compact presentation <n> B; original <n> B; exact evidence <current-evidence-uri>]
```

11. At `turn_end`, promote successful observations in Pi's assistant source order. For each selection, the last successful result becomes the next turn's baseline, whether that result was raw or compact. Evidence failure does not prevent baseline promotion because the fresh successful result was still returned raw.

The current evidence reference is mandatory: prior evidence cannot recover the current envelope's distinct tool-call ID, input, details, usage, or status.

## Invalidation and eviction

There is no filesystem invalidation path in the correctness proof. Every candidate is checked against a freshly executed result.

| Event                                                                                 | Behavior                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Successful payload mismatch                                                           | Return raw; replace baseline at `turn_end`                   |
| Successful different selection                                                        | Return raw; establish that selection's baseline              |
| Read error or deletion                                                                | Return raw; retain last successful baseline                  |
| Identical recreation after an error                                                   | May compact against the retained successful baseline         |
| Formatting, generation, known write, atomic replace, checkout/reset, or external edit | Fresh payload equality alone decides                         |
| Same mtime and size with changed content                                              | Payload mismatch; return raw                                 |
| Producer-contract change                                                              | Clear incompatible entries                                   |
| Branch/session switch or process restart                                              | Clear the in-memory ledger                                   |
| LRU memory eviction                                                                   | Next read returns raw and establishes a new baseline         |
| Current evidence failure                                                              | Return raw; successful observation may still become baseline |

The observation ledger stores identities and tool-call IDs, not source bytes. Its numeric memory bound belongs to **Set compression profiles and explicit information budgets**. Eviction affects compression ratio only.

## Concurrency

Pi can execute sibling tools in parallel and run `tool_result` handlers in completion order while persisting final tool-result messages later in assistant source order. Sandwich therefore never references a read from the same assistant turn. Freezing the ledger at turn start prevents forward references, completion-order dependence, and references to messages not yet persisted.

## Correctness boundary

The claim is exactly:

> This selected Pi-visible read result matches the latest successful observation of the same normalized selection.

It does not claim:

- the entire file was observed when Pi truncated the result;
- pre-decoding source bytes match when Pi produces the same UTF-8 replacement text;
- an image source file matches when Pi produces the same processed image payload;
- the file remains unchanged after the read completed;
- two different paths, symlink aliases, or ranges identify the same source.

The proof relies on the evidence protocol's canonicalization and SHA-256 collision-resistance assumptions, the pinned producer contract, and verified current evidence. If those assumptions cannot be established, Sandwich returns the original result.

## Adversarial matrix

| Scenario                                                 | Expected result                              |
| -------------------------------------------------------- | -------------------------------------------- |
| First observation                                        | Raw; establish baseline                      |
| Exact repeat                                             | Compact                                      |
| Relative then equivalent absolute path                   | Compact                                      |
| Direct path then symlink alias                           | Raw; different selection                     |
| Same mtime/size, changed content                         | Raw; payload mismatch                        |
| Insert before selected line range                        | Raw; payload mismatch                        |
| Atomic replacement with identical visible result         | Compact                                      |
| Same symlink path retargeted to identical visible result | Compact                                      |
| Formatter changes selected bytes                         | Raw; payload mismatch                        |
| Deletion/read error                                      | Raw; retain baseline                         |
| `A → B → A` latest-baseline sequence                     | Final `A` raw once                           |
| Current evidence commit failure                          | Raw                                          |
| Image processing changes payload                         | Raw; payload mismatch                        |
| External edit after completed matching read              | Compact observation; no future-state claim   |
| Omitted offset then explicit `offset=1`                  | Compact                                      |
| Different ranges containing identical text               | Raw; different selection                     |
| Truncation/continuation notice changes                   | Raw; payload mismatch                        |
| Deletion then identical recreation                       | Compact against retained successful baseline |
| Generator rewrites identical visible output              | Compact                                      |
| Distinct invalid UTF-8 bytes decode identically          | Compact Pi-visible observation               |
| Unrecognized byte-range producer                         | Raw                                          |
| Identical parallel sibling read                          | Raw; unavailable until next turn             |
| LRU-evicted baseline                                     | Raw; establish baseline                      |

These outcomes are executable in the throwaway TUI with `vp run prototype:exact-read`.

## Rejected alternatives

- **Stat tuple as authority:** stale when content changes under preserved/coarse metadata.
- **Known-write invalidation as authority:** misses external writers and tools outside Sandwich.
- **Pre-execution hash verification:** still reads bytes and adds a second filesystem path with race semantics.
- **Payload-only deduplication:** conflates unrelated paths and ranges.
- **`realpath`/inode identity:** introduces aliasing, platform variance, and time-of-check/time-of-use races without improving the fresh-result proof.
- **Reference prior evidence only:** cannot recover the current tool-result envelope.
- **Search any older matching payload:** makes `A → B → A` look unchanged and complicates lookup.
- **Persistent cross-process source ledger:** outside the MVP's no-cross-session-source-memory boundary.

## Consequences

The protocol cannot save filesystem execution time; it saves effective context tokens. Conservative misses occur after restart, eviction, same-turn parallel reads, alias spellings, and restored older content. Those misses are intentional: each produces raw truth rather than a stale or misleading reference.
