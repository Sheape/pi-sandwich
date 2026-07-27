import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawn, spawnSync } from "node:child_process";

const script = fileURLToPath(import.meta.url);
const encoder = new TextEncoder();

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function payload(index: number, bytes = 16_384) {
  const line = `tool=check index=${index} status=ok diagnostic=none path=src/example-${index}.ts\n`;
  return Buffer.from(line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes));
}

async function stageRecord(root: string, bytes: Buffer, compressed = false, created = Date.now()) {
  const id = hash(bytes);
  const stagingRoot = join(root, "staging");
  const target = join(root, "records", id.slice(0, 2), id);
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(dirname(target), { recursive: true });
  const staged = await mkdtemp(join(stagingRoot, "record-"));
  const stored = compressed ? gzipSync(bytes) : bytes;
  await writeFile(join(staged, compressed ? "evidence.gz" : "evidence.bin"), stored);
  await writeFile(
    join(staged, "receipt.json"),
    `${JSON.stringify({ schema: 1, id, hash: id, bytes: bytes.length, encoding: compressed ? "gzip" : "identity", pinned: true, created })}\n`,
  );
  await verifyRecord(staged);
  return { id, staged, target, storedBytes: stored.length };
}

async function commitRecord(root: string, bytes: Buffer, compressed = false, created = Date.now()) {
  const record = await stageRecord(root, bytes, compressed, created);
  try {
    await rename(record.staged, record.target);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" &&
      (error as NodeJS.ErrnoException).code !== "ENOTEMPTY"
    ) {
      throw error;
    }
    await rm(record.staged, { recursive: true, force: true });
    await verifyRecord(record.target);
  }
  return record;
}

async function verifyRecord(path: string) {
  const receipt = JSON.parse(await readFile(join(path, "receipt.json"), "utf8"));
  const stored = await readFile(
    join(path, receipt.encoding === "gzip" ? "evidence.gz" : "evidence.bin"),
  );
  const original = receipt.encoding === "gzip" ? gunzipSync(stored) : stored;
  if (original.length !== receipt.bytes || hash(original) !== receipt.hash) {
    throw new Error(`integrity failure: ${receipt.id}`);
  }
  return { receipt, original };
}

async function recordPaths(root: string) {
  const records = join(root, "records");
  const prefixes = await readdir(records).catch(() => []);
  const paths: string[] = [];
  for (const prefix of prefixes) {
    for (const id of await readdir(join(records, prefix))) paths.push(join(records, prefix, id));
  }
  return paths;
}

async function directorySize(path: string): Promise<number> {
  const entry = await stat(path);
  if (entry.isFile()) return entry.size;
  let total = 0;
  for (const child of await readdir(path)) total += await directorySize(join(path, child));
  return total;
}

function elapsed(start: bigint) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

async function measureFiles(root: string, compressed = false, indexed = false) {
  const count = 200;
  const startedWrite = process.hrtime.bigint();
  for (let index = 0; index < count; index++) {
    const record = await commitRecord(root, payload(index), compressed, index);
    if (indexed) {
      await appendFile(
        join(root, "index.jsonl"),
        `${JSON.stringify({ id: record.id, created: index })}\n`,
      );
    }
  }
  const writeMs = elapsed(startedWrite);
  const paths = await recordPaths(root);

  const startedRead = process.hrtime.bigint();
  for (const path of paths) await verifyRecord(path);
  const readMs = elapsed(startedRead);

  const startedLookup = process.hrtime.bigint();
  const wanted = hash(payload(count - 1));
  const found = Boolean(
    await stat(join(root, "records", wanted.slice(0, 2), wanted)).catch(() => undefined),
  );
  const idLookupMs = elapsed(startedLookup);

  const startedTail = process.hrtime.bigint();
  const tail = indexed
    ? (await readFile(join(root, "index.jsonl"), "utf8")).trimEnd().split("\n").slice(-10)
    : (
        await Promise.all(
          (
            await recordPaths(root)
          ).map(async (path) => ({
            path,
            created: JSON.parse(await readFile(join(path, "receipt.json"), "utf8"))
              .created as number,
          })),
        )
      )
        .sort((left, right) => right.created - left.created)
        .slice(0, 10);
  const tailMs = elapsed(startedTail);

  return {
    records: paths.length,
    writeMs,
    readMs,
    idLookupMs,
    tailMs,
    found,
    tailCount: tail.length,
    diskBytes: await directorySize(root),
  };
}

async function sqliteModule() {
  return import("node:sqlite").catch(() => undefined);
}

async function openDatabase(path: string) {
  const sqlite = await sqliteModule();
  if (!sqlite) return undefined;
  await mkdir(dirname(path), { recursive: true });
  const database = new sqlite.DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
  database.exec(
    "CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, bytes BLOB NOT NULL, byte_length INTEGER NOT NULL, pinned INTEGER NOT NULL CHECK (pinned = 1), created INTEGER NOT NULL)",
  );
  return database;
}

async function measureSqlite(root: string) {
  const path = join(root, "evidence.sqlite");
  const database = await openDatabase(path);
  if (!database) return { available: false };
  const insert = database.prepare(
    "INSERT OR IGNORE INTO evidence (id, bytes, byte_length, pinned, created) VALUES (?, ?, ?, 1, ?)",
  );
  const count = 200;
  const startedWrite = process.hrtime.bigint();
  for (let index = 0; index < count; index++) {
    const bytes = payload(index);
    database.exec("BEGIN IMMEDIATE");
    insert.run(hash(bytes), bytes, bytes.length, index);
    database.exec("COMMIT");
  }
  const writeMs = elapsed(startedWrite);

  const startedRead = process.hrtime.bigint();
  const rows = database.prepare("SELECT id, bytes, byte_length FROM evidence").all() as Array<{
    id: string;
    bytes: Uint8Array;
    byte_length: number;
  }>;
  for (const row of rows) {
    if (row.byte_length !== row.bytes.length || hash(row.bytes) !== row.id)
      throw new Error(`integrity failure: ${row.id}`);
  }
  const readMs = elapsed(startedRead);

  const wanted = hash(payload(count - 1));
  const startedLookup = process.hrtime.bigint();
  const found = Boolean(database.prepare("SELECT 1 FROM evidence WHERE id = ?").get(wanted));
  const idLookupMs = elapsed(startedLookup);

  const startedTail = process.hrtime.bigint();
  const tail = database.prepare("SELECT id FROM evidence ORDER BY created DESC LIMIT 10").all();
  const tailMs = elapsed(startedTail);
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  database.close();
  return {
    available: true,
    records: rows.length,
    writeMs,
    readMs,
    idLookupMs,
    tailMs,
    found,
    tailCount: tail.length,
    diskBytes: (await stat(path)).size,
  };
}

function child(arguments_: string[]) {
  return new Promise<void>((resolve, reject) => {
    const process_ = spawn(process.execPath, [script, "--worker", ...arguments_], {
      stdio: "ignore",
    });
    process_.once("error", reject);
    process_.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)),
    );
  });
}

async function worker(kind: string, root: string, workerId = "0") {
  if (kind === "stage-only") {
    await stageRecord(root, payload(999));
    return;
  }
  if (kind === "commit") {
    await commitRecord(root, payload(998));
    return;
  }
  if (kind === "files") {
    for (let index = 0; index < 25; index++)
      await commitRecord(root, payload(Number(workerId) * 1000 + index));
    await commitRecord(root, payload(777));
    return;
  }
  if (kind === "indexed") {
    for (let index = 0; index < 25; index++) {
      const record = await commitRecord(root, payload(Number(workerId) * 1000 + index));
      await appendFile(join(root, "index.jsonl"), `${JSON.stringify({ id: record.id })}\n`);
    }
    return;
  }
  const database = await openDatabase(join(root, "evidence.sqlite"));
  if (!database) throw new Error("node:sqlite unavailable");
  const insert = database.prepare(
    "INSERT OR IGNORE INTO evidence (id, bytes, byte_length, pinned, created) VALUES (?, ?, ?, 1, ?)",
  );
  for (let index = 0; index < 25; index++) {
    const bytes = payload(Number(workerId) * 1000 + index);
    database.exec("BEGIN IMMEDIATE");
    insert.run(hash(bytes), bytes, bytes.length, Number(workerId) * 1000 + index);
    database.exec("COMMIT");
  }
  database.close();
}

async function recoveryProbe(root: string) {
  const files = join(root, "files");
  await child(["stage-only", files]);
  const stagedBeforeCleanup = (await readdir(join(files, "staging"))).length;
  await child(["commit", files]);
  const committedAfterRestart = (await recordPaths(files)).length;
  const cleanupStarted = process.hrtime.bigint();
  await rm(join(files, "staging"), { recursive: true, force: true });
  return {
    stagedBeforeCleanup,
    committedAfterRestart,
    cleanupMs: elapsed(cleanupStarted),
    action: "remove abandoned staging; retain verified committed records",
  };
}

async function concurrencyProbe(root: string, sqliteAvailable: boolean) {
  const files = join(root, "files");
  const indexed = join(root, "indexed");
  const sqlite = join(root, "sqlite");
  await Promise.all(Array.from({ length: 4 }, (_, id) => child(["files", files, String(id)])));
  await Promise.all(Array.from({ length: 4 }, (_, id) => child(["indexed", indexed, String(id)])));
  if (sqliteAvailable)
    await Promise.all(Array.from({ length: 4 }, (_, id) => child(["sqlite", sqlite, String(id)])));
  const indexLines = (await readFile(join(indexed, "index.jsonl"), "utf8")).trimEnd().split("\n");
  let sqliteResult: { expected: number; actual: unknown } | { available: false } = {
    available: false,
  };
  if (sqliteAvailable) {
    const database = (await openDatabase(join(sqlite, "evidence.sqlite")))!;
    sqliteResult = {
      expected: 100,
      actual: database.prepare("SELECT count(*) AS count FROM evidence").get(),
    };
    database.close();
  }
  return {
    files: { expectedUnique: 101, actual: (await recordPaths(files)).length },
    indexed: {
      expected: 100,
      actualRecords: (await recordPaths(indexed)).length,
      validLines: indexLines.filter((line) => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      }).length,
    },
    sqlite: sqliteResult,
  };
}

async function corruptionProbe(root: string, sqliteAvailable: boolean) {
  const files = join(root, "files");
  await commitRecord(files, payload(1));
  await commitRecord(files, payload(2));
  const paths = await recordPaths(files);
  await writeFile(join(paths[0], "evidence.bin"), encoder.encode("corrupt"), { flush: true });
  let isolatedFileCorruptionDetected = false;
  try {
    await verifyRecord(paths[0]);
  } catch {
    isolatedFileCorruptionDetected = true;
  }
  const siblingStillReadable = Boolean(await verifyRecord(paths[1]));

  const index = join(root, "index.jsonl");
  await writeFile(index, '{"id":"complete"}\n{"id":', { flush: true });
  const lines = (await readFile(index, "utf8")).split("\n").filter(Boolean);
  let validIndexLines = 0;
  for (const line of lines) {
    try {
      JSON.parse(line);
      validIndexLines++;
    } catch {}
  }

  let sqliteCorruptionDetected: boolean | undefined;
  if (sqliteAvailable) {
    const source = join(root, "source.sqlite");
    const database = await openDatabase(source);
    database!
      .prepare("INSERT INTO evidence VALUES (?, ?, ?, 1, 0)")
      .run(hash(payload(1)), payload(1), payload(1).length);
    database!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database!.close();
    const corrupt = join(root, "corrupt.sqlite");
    await copyFile(source, corrupt);
    const handle = await open(corrupt, "r+");
    await handle.write(Buffer.alloc(16), 0, 16, 0);
    await handle.sync();
    await handle.close();
    try {
      const check = await openDatabase(corrupt);
      check?.prepare("PRAGMA integrity_check").all();
      check?.close();
      sqliteCorruptionDetected = false;
    } catch {
      sqliteCorruptionDetected = true;
    }
  }
  return {
    files: { isolatedFileCorruptionDetected, siblingStillReadable },
    jsonl: { totalLines: lines.length, validIndexLines, rebuildSource: "record directories" },
    sqlite: {
      corruptionDetected: sqliteCorruptionDetected,
      impact: "database-wide until restored or salvaged",
    },
  };
}

function noisyPayload(bytes: number) {
  const result = Buffer.allocUnsafe(bytes);
  let state = 0x12345678;
  for (let offset = 0; offset < bytes; offset++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    result[offset] = state;
  }
  return result;
}

async function measureLargeBlob(root: string, bytes: Buffer) {
  const rawStart = process.hrtime.bigint();
  const raw = await commitRecord(join(root, "raw"), bytes);
  const rawWriteMs = elapsed(rawStart);
  const gzipStart = process.hrtime.bigint();
  const gzip = await commitRecord(join(root, "gzip"), bytes, true);
  const gzipWriteMs = elapsed(gzipStart);

  const database = await openDatabase(join(root, "sqlite", "evidence.sqlite"));
  let sqlite:
    | { available: false }
    | { available: true; writeMs: number; readMs: number; diskBytes: number } = {
    available: false,
  };
  if (database) {
    const id = hash(bytes);
    const sqliteWriteStart = process.hrtime.bigint();
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare(
        "INSERT INTO evidence (id, bytes, byte_length, pinned, created) VALUES (?, ?, ?, 1, 0)",
      )
      .run(id, bytes, bytes.length);
    database.exec("COMMIT");
    const writeMs = elapsed(sqliteWriteStart);
    const sqliteReadStart = process.hrtime.bigint();
    const stored = database.prepare("SELECT bytes FROM evidence WHERE id = ?").get(id) as {
      bytes: Uint8Array;
    };
    if (hash(stored.bytes) !== id) throw new Error(`integrity failure: ${id}`);
    const readMs = elapsed(sqliteReadStart);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    database.close();
    sqlite = {
      available: true,
      writeMs,
      readMs,
      diskBytes: (await stat(join(root, "sqlite", "evidence.sqlite"))).size,
    };
  }

  return {
    originalBytes: bytes.length,
    raw: { storedBytes: raw.storedBytes, writeMs: rawWriteMs },
    gzip: {
      storedBytes: gzip.storedBytes,
      writeMs: gzipWriteMs,
      ratio: gzip.storedBytes / bytes.length,
    },
    sqlite,
  };
}

async function largeBlobProbe(root: string) {
  return {
    repetitiveToolOutput: await measureLargeBlob(join(root, "text"), payload(123, 8 * 1024 * 1024)),
    incompressible: await measureLargeBlob(join(root, "noise"), noisyPayload(8 * 1024 * 1024)),
  };
}

function libc(runtimeReport: { header?: { glibcVersionRuntime?: string } } | undefined) {
  if (process.platform !== "linux") return "none";
  if (runtimeReport?.header?.glibcVersionRuntime)
    return `glibc-${runtimeReport.header.glibcVersionRuntime}`;
  const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
  return /musl/i.test(`${ldd.stdout}${ldd.stderr}`) ? "musl" : "unknown";
}

function filenamePart(value: string) {
  return value.replaceAll(/[^a-z0-9.-]+/gi, "-");
}

async function main() {
  if (process.argv[2] === "--worker") {
    await worker(process.argv[3], process.argv[4], process.argv[5]);
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "pi-sandwich-evidence-prototype-"));
  try {
    const sqlite = await sqliteModule();
    const runtimeReport = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    const report = {
      question:
        "Which dependency-free evidence backend should Sandwich use for its process-crash durability tier?",
      protocol: {
        version: 2,
        durability: "process-crash-only",
        prepare: "write, close, read back, and verify bytes plus receipt",
        commit: "same-filesystem directory rename",
        fsync: false,
      },
      limitations: [
        "No machine-crash or power-loss durability claim.",
        "Measurements characterize only the reported Node build, libc, OS, architecture, and filesystem.",
      ],
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        sqlite: process.versions.sqlite,
        libc: libc(runtimeReport),
      },
      measurements: {
        files: await measureFiles(join(root, "measure-files")),
        indexedFiles: await measureFiles(join(root, "measure-indexed"), false, true),
        gzipFiles: await measureFiles(join(root, "measure-gzip"), true),
        sqlite: await measureSqlite(join(root, "measure-sqlite")),
        largeBlob: await largeBlobProbe(join(root, "large")),
      },
      recovery: await recoveryProbe(join(root, "recovery")),
      concurrency: await concurrencyProbe(join(root, "concurrency"), Boolean(sqlite)),
      corruption: await corruptionProbe(join(root, "corruption"), Boolean(sqlite)),
      provisionalRecommendation: {
        backend: "content-addressed record directories with per-record receipt metadata",
        index:
          "none authoritative; add a rebuildable accelerator only when measured lookup volume requires it",
        encoding:
          "raw canonical bytes by default; compression remains an independent profile decision",
        reason:
          "one rename commits bytes and receipt together, corruption is record-local, recovery is a directory scan, and no database/API availability becomes part of the safety floor",
      },
    };
    const runtime = `node${process.versions.node.split(".")[0]}`;
    const name = [process.platform, process.arch, report.environment.libc, runtime]
      .map(filenamePart)
      .join("-")
      .concat(".json");
    const output = join(dirname(script), "results", name);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nSaved ${output}`);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

await main();
