# Shared compression contract flowchart

> **Planning artifact for [Set the immutable compression and fail-open contract](https://github.com/Sheape/pi-sandwich/issues/5).** This describes the agreed contract, not implemented behavior.

```mermaid
flowchart TD
    A[Pi tool_result hook receives result] --> B[Freeze complete canonical input envelope]
    B --> B1[Exact source bytes<br/>No newline, Unicode, or ANSI normalization<br/>UTF-8 for textual input]
    B1 --> C[Compute SHA-256 and byte length locally]
    C --> D[Apply infallible static adapter scopes]

    D --> E{Any statically eligible<br/>specialized adapters?}
    E -- No --> GC[Generic core becomes<br/>the only possible lossy owner]
    E -- Yes --> F[Run every eligible dynamic matcher<br/>Pure, isolated, immutable input<br/>Per-matcher and total deadlines]

    F --> G{Did any eligible<br/>matcher fail?}
    G -- Yes --> G1[ADAPTER_MATCH_FAILURE<br/>Update session-local circuit breaker]
    G1 --> SF[Configured safe fallback]

    G -- No --> H{Highest-priority<br/>matching result}
    H -- No matches --> GC
    H -- One unique winner --> SA[Winner becomes the sole<br/>specialized lossy owner]
    H -- Tied winners --> H1[AMBIGUOUS_ADAPTER_MATCH<br/>Record non-sensitive diagnostics]
    H1 --> SF

    SF --> P{Fallback policy}
    P -- lossless-generic default --> LG[Apply only generic cleanup<br/>that claims exact reversibility]
    P -- raw strict/debug --> RAW[Return untouched original]

    GC --> Q[Owner declares one candidate path]
    SA --> Q
    Q --> R{Requested classification}

    R -- irreversibly lossy --> REJECT[Reject transformation]
    REJECT --> RAW

    R -- lossless candidate --> LT[Transform privately in killable isolation]
    LT -->|throw, timeout, abort,<br/>or malformed result| RAW
    LT --> LC[Apply only reversible core cleanup]
    LG --> LV
    LC --> LV[Restore final compact bytes<br/>using inline metadata in isolation]
    LV --> EQ{Reconstructed bytes exactly equal<br/>the canonical source bytes?}
    EQ -- No --> LF[LOSSLESS_VERIFICATION_FAILURE<br/>Discard candidate completely]
    LF --> RAW
    EQ -- Yes --> FV

    R -- externally recoverable candidate --> ES[Core stores exact canonical bytes<br/>Adapter has no storage capability]
    ES --> ER{Versioned receipt matches local<br/>SHA-256 and byte length?}
    ER -- No --> EI[EVIDENCE_INTEGRITY_FAILURE]
    EI --> RAW
    ER -- Yes --> ET[Pass immutable verified receipt<br/>to the selected owner]
    ET --> EX[Transform privately exactly once<br/>and embed stable evidence reference]
    EX -->|throw, timeout, abort,<br/>or malformed result| RAW
    EX --> EC[Apply only reversible core cleanup]
    EC --> EV[Independently validate final candidate<br/>with a machine-checkable schema]
    EV --> V{Every factual claim, status,<br/>excerpt, and evidence reference valid?}
    V -- No or indeterminate --> VF[EXTERNAL_CANDIDATE_VALIDATION_FAILURE<br/>Discard candidate; evidence may be orphaned]
    VF --> RAW
    V -- Yes --> FV[Final contract validation]

    FV --> Z{Preserves immutable identity,<br/>ordering, and failure semantics?}
    Z -- No --> RAW
    Z -- Yes --> COMMIT[Return exactly one replacement patch]
    COMMIT --> IMM[Pi inserts compact result once<br/>History entry is immutable and opaque]

    RAW --> OPEN[FAIL_OPEN<br/>Return complete original result unchanged<br/>even when oversized]

    IMM --> RR{Later explicit<br/>recovery request?}
    RR -- No --> END[Continue without rewriting history]
    RR -- Yes --> FETCH[Core fetches evidence by stable ID]
    FETCH --> CHECK[Recompute byte length and SHA-256]
    CHECK --> OK{Matches stored receipt?}
    OK -- Yes --> NEW[Return verified bytes in a new result<br/>Original compact history stays unchanged]
    OK -- No --> RERR[evidence_integrity_error<br/>Never claim successful recovery]

    classDef safe fill:#d9f2e6,stroke:#16794b,color:#111;
    classDef failure fill:#fde2e2,stroke:#b42318,color:#111;
    classDef decision fill:#fff3cd,stroke:#9a6700,color:#111;
    classDef immutable fill:#e5e7ff,stroke:#4f46e5,color:#111;

    class COMMIT,NEW safe;
    class RAW,OPEN,REJECT,LF,EI,VF,RERR failure;
    class E,G,H,P,Q,R,ER,EQ,V,Z,RR,OK decision;
    class IMM,END immutable;
```

## Governing invariants

1. **One input:** all matching sees the same untouched, immutable canonical envelope.
2. **One owner:** at most one specialized adapter or the generic core owns lossy reduction; owners never chain.
3. **Three classifications:** `lossless`, `externally recoverable`, and forbidden `irreversibly lossy`.
4. **Evidence is not validation:** a valid receipt proves recoverability, not that compact context is truthful.
5. **One visible outcome:** the pipeline returns one fully validated compact patch or the untouched original.
6. **Immutable history:** compact results are inserted once; recovery appends a new result rather than rewriting history.
7. **Failure stays failure:** command failure status and mechanically verifiable diagnostics survive compression.
8. **Uncertainty reduces compression:** ambiguity, matcher failure, timeout, corruption, or indeterminate validation selects lossless cleanup or fail-open behavior.
