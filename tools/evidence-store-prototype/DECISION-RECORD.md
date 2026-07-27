# Portable evidence-store backend decision record

**Status:** Provisional pending runs on musl Void Linux and Apple Silicon macOS, plus human review.

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

Core writes and flushes both staged files, reads and verifies the canonical bytes, marks the immutable receipt pinned, then renames the whole non-empty directory into `records/` on the same filesystem. That rename is the only commit-and-pin visibility point.

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

The committed [Linux result](results/linux-x64-glibc-node24.json) is from x86-64 glibc Void Linux, Node 24.18.0, and SQLite 3.53.1. It is not evidence for either required target class.

| 200 × 16 KiB records    | Record directories |        + JSONL accelerator |  SQLite BLOBs |
| ----------------------- | -----------------: | -------------------------: | ------------: |
| Write                   |             473 ms |                   1,099 ms |         48 ms |
| Read and hash all       |             196 ms |                     191 ms |         22 ms |
| Receipt ID lookup       |            0.89 ms |                    0.55 ms |       0.11 ms |
| Tail 10                 |              53 ms |                    0.53 ms |       2.05 ms |
| Concurrent writers      |     101/101 unique |        100/100 valid lines |  100/100 rows |
| Corruption blast radius |         One record | Rebuild index from records | Database-wide |

For an 8 MiB repetitive result, gzip stored 28,565 bytes and added about 43 ms to the raw file write. For an 8 MiB incompressible result, gzip stored 8,391,191 bytes and took 938 ms versus 148 ms raw. SQLite stored either raw 8 MiB BLOB in about 8.4 MiB and wrote it in 48–70 ms on this host.

The file layout accepts slower bulk operations to keep the recovery authority transparent, dependency-free, and record-local. SQLite's speed justifies a later rebuildable index, not putting all exact evidence behind one mutable database file before retention and query volume are known.

## Acceptance comparison

| Concern           | Record directories                             | JSONL authority                              | SQLite BLOB authority                                      |
| ----------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Portability       | Node filesystem APIs only; target runs pending | Same, but append behavior needs target proof | Built into tested Node; target package/build proof pending |
| Atomic visibility | One same-filesystem directory rename           | Blob and log cannot commit together          | One database transaction                                   |
| Concurrency       | Independent hashes do not share a mutable file | Shared append log                            | One writer at a time; busy timeout required                |
| Recovery          | Verify records; delete staging                 | Parse/repair log and reconcile blobs         | SQLite journal/WAL recovery and integrity check            |
| Compression       | Orthogonal per-record encoding                 | Orthogonal                                   | Possible before BLOB insertion                             |
| Search/tail       | O(1) by receipt ID; otherwise O(n)             | O(n) unless loaded/indexed                   | Indexed queries                                            |
| Corruption        | Record-local                                   | Log may be rebuilt from records              | Shared database failure domain                             |
| Maintenance       | Filesystem scan and ordinary tools             | Custom parser/rebuilder                      | SQL schema, checkpoints, integrity/recovery tooling        |

## Primary sources

- [Node.js 22 filesystem API](https://nodejs.org/download/release/v22.10.0/docs/api/fs.html): filesystem promises model POSIX operations; `flush: true` flushes a file descriptor before close, and `FileHandle.sync()` is exposed.
- [POSIX `rename()`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html): replacement remains visible as either old or new and the operation is specified as atomic; cross-filesystem rename may fail with `EXDEV`.
- [Node.js 22 `node:sqlite`](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html): added in Node 22.5.0; `DatabaseSync` is file-backed or in-memory and all its APIs are synchronous.
- [SQLite atomic commit](https://sqlite.org/atomiccommit.html): transactions use journaling, locking, flushing, and recovery to present all-or-nothing changes.
- [SQLite WAL](https://sqlite.org/wal.html): readers and writers can overlap, but there remains one writer and WAL introduces checkpoint/recovery state.
- [Node.js zlib](https://nodejs.org/api/zlib.html): gzip/gunzip are bundled standard-format codecs.

## Remaining evidence

Run `vp run prototype:evidence-store` on musl Void Linux and Apple Silicon macOS. Accept the backend only if both reports show:

- the same-directory record rename never exposes a partial committed directory under controlled process exits;
- concurrent same-hash writers converge without corrupting the winner;
- committed bytes and receipt verify after process restart;
- abandoned staging is removable;
- `node:sqlite` availability is recorded without becoming a safety prerequisite.
