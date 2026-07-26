# Compression contract state-machine prototype

> **THROWAWAY PROTOTYPE — not production code**

## Question

Does the compression pipeline state model agreed in [Set the immutable compression and fail-open contract](https://github.com/Sheape/pi-sandwich/issues/5) consistently guarantee deterministic single ownership, verified recoverability, immutable history insertion, and fail-open behavior across success, ambiguity, timeout, corruption, and misleading-candidate scenarios?

This prototype models the decisions made so far. It deliberately does not choose a storage backend, implement real adapters, tune budgets, or integrate with Pi.

## Run

```sh
vp run prototype:compression-contract
```

Use `n` to advance one transition at a time and `s` to cycle through scenarios. The complete relevant state is redrawn after each action. Re-run the matcher-failure scenario to trigger the session-local circuit breaker.

## What to inspect

- A compact result reaches history only after all required stages succeed.
- A committed history entry never changes.
- Adapter ambiguity and matcher uncertainty reduce compression aggressiveness.
- Evidence integrity does not validate a misleading compact candidate.
- Every pipeline failure returns the untouched original, even when it is oversized.
- Recovery corruption produces an explicit integrity error rather than false recovered content.
