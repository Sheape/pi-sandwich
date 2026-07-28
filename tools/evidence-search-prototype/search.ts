import { createHash } from "node:crypto";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export interface EvidenceEnvelope {
  schema: "sandwich-envelope/v1";
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  isError: boolean;
  content: ContentBlock[];
  details?: unknown;
  usage?: unknown;
}

export interface EvidenceRecord {
  envelope: EvidenceEnvelope;
  receipt: {
    schema: 1;
    ref: string;
    canonicalization: 1;
    hash: "sha256";
    envelope: { sha256: string; bytes: number };
    payload: { sha256: string; bytes: number };
    source: {
      toolCallId: string;
      toolName: string;
      isError: boolean;
      contentTypes: string[];
    };
    storage: { encoding: "identity"; committedAt: string };
  };
}

export interface SearchRequest {
  query: string;
  cursor?: string;
  limit?: number;
  toolName?: string;
  isError?: boolean;
  contentType?: string;
}

export interface SearchBudget {
  maxRecords: number;
  maxBytes: number;
}

export interface SearchResponse {
  query: string;
  results: Array<{
    ref: string;
    toolName: string;
    isError: boolean;
    block: number;
    match: { start: number; end: number };
    excerpt: { start: number; end: number; text: string };
  }>;
  scanned: { records: number; bytes: number };
  integrityFailures: number;
  complete: boolean;
  stopReason: "end_of_store" | "result_limit" | "scan_budget";
  nextCursor?: string;
}

interface Cursor {
  v: 1;
  committedAt: string;
  ref: string;
}

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

function makeRecord(
  committedAt: string,
  envelope: Omit<EvidenceEnvelope, "schema" | "role">,
): EvidenceRecord {
  const completeEnvelope: EvidenceEnvelope = {
    schema: "sandwich-envelope/v1",
    role: "toolResult",
    ...envelope,
  };
  const envelopeBytes = bytes(completeEnvelope);
  const payloadBytes = bytes(completeEnvelope.content);
  const envelopeHash = hash(envelopeBytes);

  return {
    envelope: completeEnvelope,
    receipt: {
      schema: 1,
      ref: `sandwich://evidence/v1/sha256/${envelopeHash}`,
      canonicalization: 1,
      hash: "sha256",
      envelope: { sha256: envelopeHash, bytes: envelopeBytes.length },
      payload: { sha256: hash(payloadBytes), bytes: payloadBytes.length },
      source: {
        toolCallId: completeEnvelope.toolCallId,
        toolName: completeEnvelope.toolName,
        isError: completeEnvelope.isError,
        contentTypes: [...new Set(completeEnvelope.content.map((block) => block.type))],
      },
      storage: { encoding: "identity", committedAt },
    },
  };
}

export function dummyEvidence(): EvidenceRecord[] {
  const records = [
    makeRecord("2026-07-27T12:06:00.000Z", {
      toolCallId: "call-check-1",
      toolName: "bash",
      input: { command: "vp check" },
      isError: false,
      content: [{ type: "text", text: "Formatting clean\nLint clean\n42 tests passed" }],
    }),
    makeRecord("2026-07-27T12:05:00.000Z", {
      toolCallId: "call-test-2",
      toolName: "bash",
      input: { command: "vp test" },
      isError: true,
      content: [
        {
          type: "text",
          text: "FAIL src/cache.test.ts\nTypeError: cache entry expired\n1 test failed, 41 tests passed",
        },
      ],
    }),
    makeRecord("2026-07-27T12:04:00.000Z", {
      toolCallId: "call-read-3",
      toolName: "read",
      input: { path: "docs/example-a.md" },
      isError: false,
      content: [{ type: "text", text: "alpha\nshared marker\nomega" }],
    }),
    makeRecord("2026-07-27T12:03:00.000Z", {
      toolCallId: "call-query-4",
      toolName: "semantic_query",
      input: { query: "find shared marker" },
      isError: false,
      content: [{ type: "text", text: "Candidate A contains shared marker in its summary." }],
    }),
    makeRecord("2026-07-27T12:02:00.000Z", {
      toolCallId: "call-corrupt-5",
      toolName: "bash",
      input: { command: "cat damaged.log" },
      isError: false,
      content: [{ type: "text", text: "needle inside a record that will be corrupted" }],
    }),
    makeRecord("2026-07-27T12:01:00.000Z", {
      toolCallId: "call-repeat-6",
      toolName: "read",
      input: { path: "repeated.txt" },
      isError: false,
      content: [{ type: "text", text: "needle first\nneedle second\nneedle third" }],
    }),
    makeRecord("2026-07-27T12:00:00.000Z", {
      toolCallId: "call-image-7",
      toolName: "read",
      input: { path: "diagram.png" },
      isError: false,
      content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" }],
    }),
  ];

  records[4]!.envelope.content = [
    { type: "text", text: "needle inside bytes changed after the receipt was committed" },
  ];
  return records;
}

function recordOrder(a: EvidenceRecord, b: EvidenceRecord) {
  return (
    b.receipt.storage.committedAt.localeCompare(a.receipt.storage.committedAt) ||
    a.receipt.ref.localeCompare(b.receipt.ref)
  );
}

function encodeCursor(record: EvidenceRecord) {
  const cursor: Cursor = {
    v: 1,
    committedAt: record.receipt.storage.committedAt,
    ref: record.receipt.ref,
  };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString()) as Partial<Cursor>;
    if (
      cursor.v !== 1 ||
      typeof cursor.committedAt !== "string" ||
      typeof cursor.ref !== "string"
    ) {
      throw new Error();
    }
    return cursor as Cursor;
  } catch {
    throw new Error("invalid_cursor");
  }
}

function startsAfterCursor(record: EvidenceRecord, cursor: Cursor) {
  const committedAt = record.receipt.storage.committedAt;
  return (
    committedAt < cursor.committedAt ||
    (committedAt === cursor.committedAt && record.receipt.ref > cursor.ref)
  );
}

function verify(record: EvidenceRecord) {
  const envelopeBytes = bytes(record.envelope);
  return (
    envelopeBytes.length === record.receipt.envelope.bytes &&
    hash(envelopeBytes) === record.receipt.envelope.sha256
  );
}

function excerpt(text: string, matchStart: number, matchBytes: number) {
  const textBytes = Buffer.from(text);
  let start = Math.max(0, matchStart - 40);
  let end = Math.min(textBytes.length, matchStart + matchBytes + 40);
  while (start < matchStart && (textBytes[start]! & 0xc0) === 0x80) start++;
  while (end < textBytes.length && (textBytes[end]! & 0xc0) === 0x80) end--;
  return { start, end, text: textBytes.subarray(start, end).toString() };
}

function firstMatch(record: EvidenceRecord, query: Buffer) {
  for (const [block, content] of record.envelope.content.entries()) {
    if (content.type !== "text") continue;
    const offset = Buffer.from(content.text).indexOf(query);
    if (offset >= 0) return { block, offset, text: content.text };
  }
  return undefined;
}

export function searchEvidence(
  source: EvidenceRecord[],
  request: SearchRequest,
  budget: SearchBudget,
): SearchResponse {
  const query = Buffer.from(request.query);
  const limit = request.limit ?? 20;
  if (query.length === 0 || query.length > 256) throw new Error("invalid_query");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid_limit");

  const records = [...source].sort(recordOrder);
  const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
  const cursorStart = cursor ? records.findIndex((record) => startsAfterCursor(record, cursor)) : 0;
  const start = cursorStart === -1 ? records.length : cursorStart;
  let scannedRecords = 0;
  let scannedBytes = 0;
  let integrityFailures = 0;
  let lastScanned: EvidenceRecord | undefined;
  const results: SearchResponse["results"] = [];

  for (let index = start; index < records.length; index++) {
    if (scannedRecords >= budget.maxRecords) {
      return {
        query: request.query,
        results,
        scanned: { records: scannedRecords, bytes: scannedBytes },
        integrityFailures,
        complete: false,
        stopReason: "scan_budget",
        nextCursor: lastScanned && encodeCursor(lastScanned),
      };
    }

    const record = records[index]!;
    scannedRecords++;
    lastScanned = record;
    const { source: metadata } = record.receipt;
    if (
      (request.toolName !== undefined && metadata.toolName !== request.toolName) ||
      (request.isError !== undefined && metadata.isError !== request.isError) ||
      (request.contentType !== undefined && !metadata.contentTypes.includes(request.contentType))
    ) {
      continue;
    }

    const recordBytes = record.receipt.envelope.bytes;
    if (scannedBytes > 0 && scannedBytes + recordBytes > budget.maxBytes) {
      scannedRecords--;
      lastScanned = records[index - 1];
      return {
        query: request.query,
        results,
        scanned: { records: scannedRecords, bytes: scannedBytes },
        integrityFailures,
        complete: false,
        stopReason: "scan_budget",
        nextCursor: lastScanned && encodeCursor(lastScanned),
      };
    }
    scannedBytes += recordBytes;

    if (!verify(record)) {
      integrityFailures++;
      continue;
    }

    const match = firstMatch(record, query);
    if (!match) continue;
    results.push({
      ref: record.receipt.ref,
      toolName: metadata.toolName,
      isError: metadata.isError,
      block: match.block,
      match: { start: match.offset, end: match.offset + query.length },
      excerpt: excerpt(match.text, match.offset, query.length),
    });

    if (results.length === limit && index < records.length - 1) {
      return {
        query: request.query,
        results,
        scanned: { records: scannedRecords, bytes: scannedBytes },
        integrityFailures,
        complete: false,
        stopReason: "result_limit",
        nextCursor: encodeCursor(record),
      };
    }
  }

  return {
    query: request.query,
    results,
    scanned: { records: scannedRecords, bytes: scannedBytes },
    integrityFailures,
    complete: true,
    stopReason: "end_of_store",
  };
}
