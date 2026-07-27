# Portable evidence-store backend decision record

**Status:** Accepted. Protocol version 2 passed on x86-64 glibc Void Linux and Apple Silicon macOS.

## Question

Which dependency-free backend best preserves exact canonical evidence with one atomic visibility point, stable receipt lookup, process-crash recovery, concurrent local processes, bounded cost, and portability?

## Recommended decision

Use content-addressed record directories as the authoritative evidence store:

```text
<root>/
  staging/<random>/
    evidence.bin
    receipt.json
  records/<first-two-hash-chars>/<full-sha256>/
    evidence.bin
    receipt.json
```

Core writes and closes both staged files, reads and verifies the canonical bytes, marks the immutable receipt pinned, then renames the whole non-empty directory into `records/` on the same filesystem. That rename is the only commit-and-pin visibility point. The process-crash tier deliberately omits `fsync`; flushing nonvolatile storage belongs to the unclaimed machine-crash tier.

- A process exit before rename leaves an unreferenced staging directory that startup reconciliation removes.
- A process exit after rename leaves a complete committed record that startup reconciliation verifies and retains.
- Concurrent writers of the same hash converge on one directory; a loser verifies the winner and removes its staging directory.
- Stable receipt recovery derives the path directly from the hash. Arbitrary search and tail operations scan records in O(n).
- Corruption is isolated to one record and detected by recomputing its canonical hash and length.

This decision claims process-crash and restart recovery only. It does **not** claim machine-crash or power-loss durability.

## Index and compression boundaries

- No index is authoritative. Add a rebuildable SQLite metadata accelerator only when measured record volume makes O(n) maintenance queries material; the evidence safety floor must still work when `node:sqlite` is absent or its index is corrupt.
- Do not add an authoritative JSONL log. Concurrent append and malformed-tail recovery add a second protocol without improving receipt-by-ID lookup.
- Store raw canonical bytes by default. Gzip is an independent profile decision: it greatly helps repetitive text but expands incompressible input and adds CPU/decoder obligations.

## Probe result

The protocol-version-2 [glibc Void Linux result](results/linux-x64-glibc-2.41-node24.json) and [Apple Silicon macOS result](results/darwin-arm64-none-node24.json) both used Node 24.18.0 and SQLite 3.53.1.

| 200 × 16 KiB records | Linux records | Linux + JSONL | Linux SQLite | macOS records | macOS + JSONL | macOS SQLite |
| -------------------- | ------------: | ------------: | -----------: | ------------: | ------------: | -----------: |
| Write                |        370 ms |        289 ms |        52 ms |         80 ms |         86 ms |        17 ms |
| Read and hash all    |         93 ms |        105 ms |        28 ms |         21 ms |         19 ms |       1.7 ms |
| Receipt ID lookup    |       0.44 ms |       0.21 ms |      0.12 ms |       0.10 ms |       0.03 ms |      0.01 ms |
| Tail 10              |         38 ms |       0.26 ms |      2.17 ms |       5.72 ms |       0.06 ms |      0.38 ms |

Both targets recovered one committed record after process restart, identified and removed one abandoned staging record, converged concurrent same-hash file writers at 101/101 unique records, produced 100/100 valid concurrent JSONL lines and SQLite rows, detected record corruption without harming a sibling, and detected database corruption.

On both targets gzip stored the 8 MiB repetitive fixture in 28,565 bytes but expanded the incompressible fixture to 8,391,191 bytes. This confirms that compression remains profile-dependent rather than part of the backend safety floor.

The file layout accepts slower bulk operations to keep the recovery authority transparent, dependency-free, and record-local. SQLite's speed justifies a later rebuildable index, not putting all exact evidence behind one mutable database file before retention and query volume are known.

## Acceptance comparison

| Concern           | Record directories                             | JSONL authority                                    | SQLite BLOB authority                                |
| ----------------- | ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Portability       | Protocol v2 passed both target classes         | Concurrent probe passed; remains non-authoritative | Available on both targets; not a safety prerequisite |
| Atomic visibility | One same-filesystem directory rename           | Blob and log cannot commit together                | One database transaction                             |
| Concurrency       | Independent hashes do not share a mutable file | Shared append log                                  | One writer at a time; busy timeout required          |
| Recovery          | Verify records; delete staging                 | Parse/repair log and reconcile blobs               | SQLite journal/WAL recovery and integrity check      |
| Compression       | Orthogonal per-record encoding                 | Orthogonal                                         | Possible before BLOB insertion                       |
| Search/tail       | O(1) by receipt ID; otherwise O(n)             | O(n) unless loaded/indexed                         | Indexed queries                                      |
| Corruption        | Record-local                                   | Log may be rebuilt from records                    | Shared database failure domain                       |
| Maintenance       | Filesystem scan and ordinary tools             | Custom parser/rebuilder                            | SQL schema, checkpoints, integrity/recovery tooling  |

## Primary sources

- [Node.js 22 filesystem API](https://nodejs.org/download/release/v22.10.0/docs/api/fs.html): filesystem promises model POSIX operations and expose the write, close, read, and rename primitives used by the process-crash protocol.
- [POSIX `rename()`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html): replacement remains visible as either old or new and the operation is specified as atomic; cross-filesystem rename may fail with `EXDEV`.
- [Node.js 22 `node:sqlite`](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html): added in Node 22.5.0; `DatabaseSync` is file-backed or in-memory and all its APIs are synchronous.
- [SQLite atomic commit](https://sqlite.org/atomiccommit.html): transactions use journaling, locking, flushing, and recovery to present all-or-nothing changes.
- [SQLite WAL](https://sqlite.org/wal.html): readers and writers can overlap, but there remains one writer and WAL introduces checkpoint/recovery state.
- [Node.js zlib](https://nodejs.org/api/zlib.html): gzip/gunzip are bundled standard-format codecs.

## Accepted evidence

Both required target reports show:

- the same-directory record rename never exposes a partial committed directory under controlled process exits;
- concurrent same-hash writers converge without corrupting the winner;
- committed bytes and receipt verify after process restart;
- abandoned staging is removable;
- `node:sqlite` is available without becoming a safety prerequisite.

The recommended decision is accepted.
