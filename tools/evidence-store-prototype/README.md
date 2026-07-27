# Evidence-store backend prototype

> **THROWAWAY PROTOTYPE — do not ship this code.**

## Question

Which dependency-free backend best satisfies Sandwich's already-chosen evidence contract: exact canonical bytes, stable hashes, staged verification, one atomic commit-and-pin point, process-crash recovery, concurrent Pi processes, bounded cost, and portability across musl Void Linux and Apple Silicon macOS?

This is an empirical persistence probe rather than a state-machine TUI: the unresolved behavior belongs to filesystems and SQLite, so repeatable failpoints and measurements answer the question better than keyboard-driven state transitions.

## Run

```sh
vp run prototype:evidence-store
```

The probe uses only Node built-ins, creates a disposable directory under the OS temporary directory, prints a comparison, and writes a machine-readable result under `results/`. Run the same command on each target platform and commit its result to this throwaway branch.

## Compared shapes

- Content-addressed record directories: raw bytes and receipt metadata staged together, then committed by one same-filesystem directory rename.
- The same record directories plus a rebuildable JSONL search accelerator.
- Node's built-in SQLite with one transactional row per evidence record.
- Gzip as an optional blob encoding, measured separately because it is not a storage backend.

## Limits

- Controlled process exits exercise recovery boundaries; this does not prove power-loss or machine-crash durability.
- Results characterize the filesystem and Node build shown in each report only.
- Retention policy, cloud synchronization, semantic indexing, and production implementation remain out of scope.
