# Working integrity and recoverability decision record

> **Status:** Working decision record for [Set the immutable compression and fail-open contract](https://github.com/Sheape/pi-sandwich/issues/5). Amended after review of the first prototype. This is an architecture artifact, not an implementation specification.

## Primary invariant

> No information is permanently destroyed by default, and no compact representation may contradict or materially misrepresent the original.

Recoverability and truthfulness are independent guarantees. Passing one never implies the other.

## Fidelity classes

```ts
type Fidelity = "verified-lossless" | "verified-externally-recoverable" | "irreversibly-lossy";
```

| Fidelity                          | Default policy       | Required proof                                                                                                                |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `verified-lossless`               | Allowed              | Per-result restoration reproduces the exact canonical payload, and the model-visible presentation independently validates     |
| `verified-externally-recoverable` | Allowed              | Exact canonical evidence is read-back verified, committed, and pinned; the model-visible presentation independently validates |
| `irreversibly-lossy`              | Rejected or disabled | Not applicable under the default safety policy                                                                                |

Strict round-trip losslessness is mandatory only when a transform requests `verified-lossless`. Most semantic compression is expected to use `verified-externally-recoverable`.

## Protected original and canonical identity

Sandwich protects the exact canonical bytes of the complete **Pi-visible `tool_result` envelope received by Sandwich**. It does not claim access to process stdout/stderr bytes or data discarded before Pi's public `tool_result` hook.

Canonicalization is an explicit, deterministic, versioned framing format—not ordinary unordered `JSON.stringify()`. It covers every field exposed at the boundary that participates in identity or semantics:

- Tool-call identity and tool name
- Result role and success/error status
- Ordered content-block identities and order
- Text, structured, and supported binary/image blocks
- Relevant immutable provider metadata exposed to Sandwich

Text blocks use UTF-8 without newline, Unicode, ANSI, or whitespace normalization. Any normalization is a separate transform.

The canonical identity records at least:

```text
payload hash
payload byte length
envelope hash
envelope byte length
hash algorithm
canonicalization version
```

The payload identity covers transformable content. The envelope identity binds immutable identity and status semantics to the payload identity.

## Decisions preserved unchanged

1. **Fail open:** if any required stage fails or becomes indeterminate, Sandwich returns the complete original Pi-visible result unchanged—even when oversized.
2. **Single candidate owner:** declarative static eligibility precedes dynamic matching; all eligible matchers see the same untouched input; one unique highest-priority match wins; specialized adapters never chain.
3. **Safe uncertainty:** an eligible matcher failure or tied highest priority makes specialized ownership indeterminate. Default fallback is approved lossless generic cleanup; strict/debug fallback is the untouched result.
4. **No order-based arbitration:** extension load order and adapter registration order never break ties.
5. **Real isolation:** matcher, transform, restoration, and validation operations require a boundary that can actually be terminated, with operation and stage deadlines plus resource limits.
6. **Irreversible loss rejected:** default behavior never commits `irreversibly-lossy` output.
7. **Failure remains failure:** core-owned status and identity prevent a failed tool result from appearing successful.
8. **One visible commit:** private candidate work yields one fully validated replacement patch or no patch.
9. **Immutable history:** an inserted compact result is never recompressed or rewritten. Recovery returns a new result.
10. **Evidence is not truth:** valid evidence can prove recoverability but cannot legitimize a contradictory compact representation.
11. **Session-local circuit breaking:** repeated adapter failures may disable that adapter for the session, visibly and without silently persisting the disablement across sessions.

## Decisions amended

| Earlier model                                                   | Corrected model                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| “Original” could be read as raw tool-process bytes              | The protected original is the versioned canonical Pi-visible envelope received at `tool_result`                                               |
| One hash and length                                             | Separate payload and envelope hashes/lengths, bound to a canonicalization version                                                             |
| “Lossless / externally recoverable / irreversibly lossy” labels | Commit states are verified: `verified-lossless` or `verified-externally-recoverable`; unverified candidates never receive those labels        |
| “Lossy owner”                                                   | `candidate owner`, refined as `specialized candidate owner` or `generic candidate owner`                                                      |
| Evidence write acknowledgment was sufficient                    | Core stages exact bytes, reads them back, recomputes identity, and keeps a verified `PREPARED` record                                         |
| Orphaned evidence was an acceptable normal fallback             | Failed candidate work transitions `PREPARED → ABORTED`; only crash recovery cleans abandoned staging records                                  |
| Evidence could be committed before candidate success            | Evidence becomes durable and pinned only after candidate proof and presentation validation succeed                                            |
| Round-trip proof was sufficient for lossless safety             | Both fidelity paths also require independent validation of the model-visible presentation                                                     |
| Schema validation could stand in for truth                      | Adapter-specific validators independently recompute factual fields, offsets, counts, statuses, and omission disclosures from the original     |
| Generic reversible cleanup could follow any adapter             | Post-adapter cleanup is forbidden unless every transform participates in a versioned, formally composed codec chain verified in reverse order |
| Final validation protected immutable fields                     | Core constructs the replacement from the frozen immutable envelope; final validation is defense in depth                                      |
| Receipt metadata could be consulted from current backend state  | Immutable history stores the expected receipt; recovery verifies against that committed receipt                                               |
| A Promise deadline could be described as isolation              | Only a worker, child process, adapter host, or equivalent terminable execution boundary qualifies                                             |
| Lossless recovery was assumed to remain available               | Decoder lifetime is a commit precondition and a newly exposed architectural decision                                                          |

## Candidate ownership

1. Apply infallible declarative static scopes.
2. Build the statically eligible set.
3. Run every eligible dynamic matcher against the same immutable input.
4. Matchers are pure, side-effect-free, bounded, and independently terminable.
5. Any eligible matcher failure makes specialized ownership indeterminate.
6. A unique highest-priority match becomes the specialized candidate owner.
7. A highest-priority tie is ambiguous.
8. Ambiguity and matcher failure select the configured safe fallback.
9. No match permits the generic candidate owner.
10. A selected owner produces at most one candidate; specialized owners never chain.

Diagnostics remain non-sensitive by default. Repeated failures feed a visible session-local circuit breaker.

## Execution boundary and resource contract

Matchers, transforms, restorers, and presentation validators run in a boundary that can be terminated. The later adapter-lifecycle decision must choose the concrete host and set:

- Per-operation and total-stage deadlines
- Input, output, metadata, and reconstructed-size limits
- Cancellation semantics
- Memory limits where practical
- Streaming hash and comparison behavior for large values

Adapters receive immutable data and cannot write history or access the evidence store directly.

## `verified-lossless` candidate path

```text
original canonical payload
→ isolated transform
→ compact payload + inline restoration metadata
→ optional formally composed codec chain
→ isolated reverse restoration
→ exact canonical payload comparison
→ independent model-visible presentation validation
→ core-owned envelope reconstruction
→ final contract and optional savings checks
→ immutable commit
```

Direct byte equality is preferred when both values fit in memory. Streaming byte comparison or SHA-256 plus byte length is acceptable for large values. A restoration operation is mandatory and cannot fetch the original from evidence storage.

A failed restoration or comparison:

1. Invalidates the candidate completely.
2. Emits `LOSSLESS_VERIFICATION_FAILURE`.
3. Never inserts or implicitly reclassifies that candidate.
4. Fails open unless a separately produced external candidate independently passes its own path.

A successful round trip still does not establish presentation truthfulness.

## `verified-externally-recoverable` candidate path

Core—not adapters—owns evidence storage:

```text
generate stable evidence ID
→ write exact canonical bytes to staged storage
→ read staged bytes back
→ recompute and compare hash and length
→ PREPARED
→ pass immutable provisional receipt to candidate owner
→ isolated transform
→ independent presentation validation
→ core-owned envelope reconstruction
→ final contract and optional savings checks
→ atomically COMMIT and PIN evidence within the backend
→ return one immutable compact replacement
```

Candidate failure transitions `PREPARED → ABORTED`. A process crash may leave abandoned staging records for recovery cleanup; normal failure does not intentionally create committed orphan evidence.

A backend echoing expected metadata is insufficient—the stored bytes must be read back and verified.

The receipt contains at least:

```text
receipt schema version
evidence ID
hash algorithm
content hash
original byte length
canonicalization version
```

The immutable compact history metadata retains the complete expected receipt. Model-visible content may display only the stable evidence ID.

Pi does not expose a transaction spanning the evidence backend and history insertion. Commit-and-pin therefore precedes returning the replacement patch: a crash can leave committed but unreferenced evidence, but cannot leave referenced evidence uncommitted. Crash reconciliation must remove or adopt such records safely.

### Chosen MVP durability tier

Committed and pinned MVP evidence must survive a Sandwich or Pi process crash and subsequent restart. Process-lifetime-only storage is rejected because persisted compact history could outlive its recoverable original.

Machine-crash survival is not claimed by the MVP unless [Choose the portable evidence-store backend](https://github.com/Sheape/pi-sandwich/issues/6) proves the required flush, atomic rename, directory synchronization, and recovery behavior on both Apple Silicon macOS and musl-based Void Linux. The implementation and documentation must state the proven tier without implying stronger durability.

## Independent presentation validation

Both verified fidelity paths require an adapter-specific validator that checks the final model-visible projection against the frozen original. A schema proves structure, not truth.

Version-one compact outputs should be composed from independently recomputed typed fields, exact excerpts with verified ranges, explicit omission markers, verified counts/statuses, stable evidence references, and approved reversible encodings. Unrestricted natural-language summaries are excluded from integrity-sensitive adapters.

The validator checks applicable facts such as status, exit code, pass/fail/skip counts, failed identities, diagnostic codes and locations, excerpt offsets, changed-file counts, conflict state, omissions, and evidence references. A contradiction or indeterminate result emits `CANDIDATE_PRESENTATION_FAILURE`, discards the candidate, and fails open.

## Core-owned immutable envelope

Adapters cannot control or replace tool-call ID, tool name, result role, success/error status, provider identity metadata, immutable content-block identity, or compression metadata authority.

Conceptually, core constructs:

```ts
const replacement = {
  ...immutableOriginalEnvelope,
  content: verifiedCompactContent,
  compression: verifiedCompressionMetadata,
};
```

Adapters may reorder diagnostic presentation only when their typed contract explicitly permits it. Immutable envelope identities and content-block identity/order remain core-owned.

## Immutable history and fidelity-specific recovery

Committed history stores fidelity, canonical identity, candidate-owner and codec versions, and—when applicable—the evidence receipt.

### Verified lossless

```text
load pinned compatible decoder/codec versions
→ restore from compact payload and inline metadata
→ recompute original payload identity
→ compare with committed identity
→ return verified original as a new result
```

### Verified externally recoverable

```text
fetch by committed evidence ID
→ recompute hash and byte length
→ compare with receipt stored in immutable history
→ return verified original as a new result
```

### Raw

The original is already present and needs no recovery.

Explicit recovery errors include:

```text
evidence_not_found
evidence_integrity_error
evidence_decoder_unavailable
evidence_receipt_version_unsupported
evidence_canonicalization_version_unsupported
```

Recovery never rewrites the compact history entry and never reports success after failed verification.

## Acceptance invariant

A candidate commits only when every applicable condition holds:

1. Ownership was determined without uncertainty.
2. Transformation completed inside enforceable resource limits.
3. The protected original remains exactly recoverable.
4. The final model-visible projection independently validated.
5. Core preserved immutable identity, ordering, and failure semantics.
6. Required evidence was read-back verified, committed, and pinned.
7. Required codecs and metadata are versioned and recoverable for the retained-history lifetime.
8. The final replacement contract passed.
9. Any configured minimum-savings threshold passed.

Otherwise Sandwich returns the complete original Pi-visible result unchanged.

## MVP complexity assessment

The complete model is too complex for an MVP if it simultaneously includes semantic external compression, durable evidence lifecycle, arbitrary verified-lossless codecs, codec composition, third-party adapters, export portability, and machine-crash guarantees.

### Safety guarantees that must remain in the MVP

- Versioned canonical Pi-visible envelope and payload/envelope identities
- Deterministic single candidate ownership and safe ambiguity handling
- Actually terminable adapter execution with fixed resource ceilings
- Core-owned immutable identity/status and immutable first insertion
- Independent presentation validation
- Fail-open behavior and default rejection of irreversible loss
- Core-owned, staged, read-back-verified evidence for semantic compression
- Immutable receipt binding and pinning for every supported retained-history lifecycle
- Fidelity-specific verified recovery and explicit recovery errors
- No arbitrary post-adapter cleanup

Removing any of these would weaken the central safety claim.

### MVP deferrals

- General specialized `verified-lossless` adapters until decoder lifetime is solved
- Multi-codec composition; permit only a single codec per lossless candidate initially
- Third-party adapter loading and a general adapter-host protocol
- Machine-crash durability claims until the backend prototype verifies them on macOS and Void Linux
- Portable session export/import unless evidence and decoder dependencies can travel with the export
- Natural-language semantic summaries
- Sophisticated profile-specific savings thresholds; begin with one conservative configurable threshold

An external-first MVP—`verified-externally-recoverable`, raw fallback, and at most narrowly bundled reversible codecs—retains the safety claim while removing the hardest decoder-lifetime and composition obligations.

### Chosen MVP fidelity boundary

The MVP is external-first:

- Semantic adapter compression uses `verified-externally-recoverable`.
- Raw fail-open remains universal.
- `verified-lossless` is permitted only for approved core-bundled codecs whose compatible decoder ships for the same supported core lifetime.
- Specialized adapter lossless proposals remain disabled until [Guarantee decoder availability for retained lossless history](https://github.com/Sheape/pi-sandwich/issues/24) establishes a retained-history decoder guarantee.
- The full fidelity type remains part of the architecture; this is an MVP enablement boundary, not removal of the lossless path.

## Newly exposed or sharpened unresolved decisions

- **Decoder lifetime:** how retained `verified-lossless` history keeps compatible restorers available across upgrades, removal, restart, and package drift is tracked by [Guarantee decoder availability for retained lossless history](https://github.com/Sheape/pi-sandwich/issues/24).
- **Canonical framing:** the exact versioned binary/text framing, block identities, and payload/envelope hash boundaries belong with [Define evidence references and recovery tools](https://github.com/Sheape/pi-sandwich/issues/7), informed by Pi's verified hook boundary.
- **Staged transaction mechanics and stronger durability:** the MVP floor is process-crash survival; backend mechanics and any machine-crash claim belong with [Choose the portable evidence-store backend](https://github.com/Sheape/pi-sandwich/issues/6).
- **Pin lifecycle:** session deletion, fork, compaction, pruning, export, and crash reconciliation belong with [Set evidence privacy, retention, and cleanup policy](https://github.com/Sheape/pi-sandwich/issues/8).
- **Execution host and resource ceilings:** worker versus process boundary and concrete limits belong with [Choose adapter registration, ownership, and isolation semantics](https://github.com/Sheape/pi-sandwich/issues/9).
- **Savings policy:** token estimates and minimum savings remain an efficiency decision in [Set compression profiles and explicit information budgets](https://github.com/Sheape/pi-sandwich/issues/12).

## Next unresolved question in this ticket

How may a verified candidate change ordered content blocks while core preserves immutable envelope identity and makes every presentation reorder explicit and verifiable?
