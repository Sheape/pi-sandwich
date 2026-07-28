import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const PRODUCER_CONTRACT = "pi-read/0.82.1";

export interface ReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface FileStatHint {
  size: number;
  mtime: string;
  inode: number;
}

export interface ReadObservation {
  toolCallId: string;
  producerContract: string;
  cwd: string;
  input: ReadInput;
  isError: boolean;
  content: ContentBlock[];
  stat?: FileStatHint;
  evidenceCommit?: "ok" | "failed";
}

export interface Scenario {
  name: string;
  event: string;
  note: string;
  prior?: ReadObservation;
  baselineUnavailableReason?: "same-turn" | "evicted";
  current: ReadObservation;
}

export type Stage = "baseline" | "fresh-read" | "selection" | "payload" | "evidence" | "outcome";

export interface PrototypeState {
  scenario: number;
  stage: Stage;
}

export interface Identity {
  bytes: number;
  sha256: string;
}

export interface Evaluation {
  sameSelection?: boolean;
  samePayload?: boolean;
  currentPayload: Identity;
  priorPayload?: Identity;
  outcome:
    | "pending"
    | "raw:first-observation"
    | "raw:same-turn-baseline"
    | "raw:evicted-baseline"
    | "raw:unsupported-producer"
    | "raw:read-error"
    | "raw:different-selection"
    | "raw:changed-payload"
    | "raw:evidence-failure"
    | "compact:unchanged";
  baselineEffect: "pending" | "keep" | "establish" | "replace" | "separate-selection";
  compactText?: string;
}

const stages: Stage[] = ["baseline", "fresh-read", "selection", "payload", "evidence", "outcome"];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`;
}

function identity(value: unknown): Identity {
  const bytes = Buffer.from(canonical(value));
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function selectionIdentity(observation: ReadObservation) {
  return {
    schema: "sandwich-read-selection/v1",
    producerContract: observation.producerContract,
    lexicalAbsolutePath: resolve(observation.cwd, observation.input.path),
    offset: observation.input.offset ?? 1,
    limit: observation.input.limit ?? null,
  };
}

export function payloadIdentity(observation: ReadObservation): Identity {
  return identity({ schema: "sandwich-payload/v1", content: observation.content });
}

function evidenceRef(observation: ReadObservation): string {
  const envelope = identity({
    schema: "sandwich-envelope/v1",
    role: "toolResult",
    toolCallId: observation.toolCallId,
    toolName: "read",
    input: observation.input,
    isError: observation.isError,
    content: observation.content,
    details: null,
    usage: null,
  });
  return `sandwich://evidence/v1/sha256/${envelope.sha256}`;
}

export function evaluate(scenario: Scenario, stage: Stage): Evaluation {
  const currentPayload = payloadIdentity(scenario.current);
  const priorPayload = scenario.prior && payloadIdentity(scenario.prior);
  const reached = (target: Stage) => stages.indexOf(stage) >= stages.indexOf(target);
  const sameSelection =
    scenario.prior === undefined
      ? undefined
      : canonical(selectionIdentity(scenario.prior)) ===
        canonical(selectionIdentity(scenario.current));
  const samePayload =
    priorPayload === undefined
      ? undefined
      : priorPayload.bytes === currentPayload.bytes &&
        priorPayload.sha256 === currentPayload.sha256;

  const pending: Evaluation = {
    sameSelection: reached("selection") ? sameSelection : undefined,
    samePayload: reached("payload") ? samePayload : undefined,
    currentPayload,
    priorPayload,
    outcome: "pending",
    baselineEffect: "pending",
  };
  if (!reached("outcome")) return pending;
  if (scenario.current.producerContract !== PRODUCER_CONTRACT) {
    return { ...pending, outcome: "raw:unsupported-producer", baselineEffect: "keep" };
  }
  if (scenario.current.isError) {
    return { ...pending, outcome: "raw:read-error", baselineEffect: "keep" };
  }
  if (!scenario.prior) {
    if (scenario.baselineUnavailableReason === "same-turn") {
      return { ...pending, outcome: "raw:same-turn-baseline", baselineEffect: "establish" };
    }
    if (scenario.baselineUnavailableReason === "evicted") {
      return { ...pending, outcome: "raw:evicted-baseline", baselineEffect: "establish" };
    }
    return { ...pending, outcome: "raw:first-observation", baselineEffect: "establish" };
  }
  if (!sameSelection) {
    return { ...pending, outcome: "raw:different-selection", baselineEffect: "separate-selection" };
  }
  if (!samePayload) {
    return { ...pending, outcome: "raw:changed-payload", baselineEffect: "replace" };
  }
  if (scenario.current.evidenceCommit !== "ok") {
    return { ...pending, outcome: "raw:evidence-failure", baselineEffect: "replace" };
  }
  const presentation = `[Sandwich: selected Pi-visible read result exactly matches latest successful observation ${scenario.prior.toolCallId}.]`;
  return {
    ...pending,
    outcome: "compact:unchanged",
    baselineEffect: "replace",
    compactText: `${presentation}\n[Sandwich: compact presentation ${Buffer.byteLength(presentation)} B; original ${currentPayload.bytes} B; exact evidence ${evidenceRef(scenario.current)}]`,
  };
}

export function advance(state: PrototypeState): PrototypeState {
  const index = stages.indexOf(state.stage);
  return { ...state, stage: stages[Math.min(index + 1, stages.length - 1)]! };
}

export function reset(scenario: number): PrototypeState {
  return { scenario, stage: "baseline" };
}

const text = (value: string): ContentBlock[] => [{ type: "text", text: value }];
const read = (
  toolCallId: string,
  input: ReadInput,
  content: ContentBlock[],
  options: Partial<Omit<ReadObservation, "toolCallId" | "input" | "content">> = {},
): ReadObservation => ({
  toolCallId,
  producerContract: PRODUCER_CONTRACT,
  cwd: "/repo",
  input,
  isError: false,
  content,
  evidenceCommit: "ok",
  ...options,
});

const sameStat = { size: 12, mtime: "12:00:00.000", inode: 41 };

export const scenarios: Scenario[] = [
  {
    name: "First observation",
    event: "No earlier successful read uses this selection key.",
    note: "Show raw output and establish an in-memory baseline.",
    current: read("read-001", { path: "src/a.ts", offset: 1, limit: 2 }, text("one\ntwo"), {
      stat: sameStat,
    }),
  },
  {
    name: "Exact repeat",
    event: "The same selection is freshly read again.",
    note: "Matching canonical payload identity permits a current-evidence reference.",
    prior: read("read-001", { path: "src/a.ts", offset: 1, limit: 2 }, text("one\ntwo"), {
      stat: sameStat,
    }),
    current: read("read-002", { path: "src/a.ts", offset: 1, limit: 2 }, text("one\ntwo"), {
      stat: sameStat,
    }),
  },
  {
    name: "Relative then absolute path",
    event: "The spelling changes but resolve(cwd, path) is identical.",
    note: "Lexical normalization treats these as one selection without realpath.",
    prior: read("read-010", { path: "src/a.ts" }, text("same bytes"), { stat: sameStat }),
    current: read("read-011", { path: "/repo/src/a.ts" }, text("same bytes"), { stat: sameStat }),
  },
  {
    name: "Symlink alias",
    event: "A direct path and symlink alias return identical bytes.",
    note: "Different lexical paths are different selections, so this stays raw.",
    prior: read("read-020", { path: "src/a.ts" }, text("same bytes"), { stat: sameStat }),
    current: read("read-021", { path: "current.ts" }, text("same bytes"), {
      stat: { ...sameStat, inode: 41 },
    }),
  },
  {
    name: "Same mtime and size, changed content",
    event: "An external writer preserves the stat tuple while changing bytes.",
    note: "Stat-only caching would be stale; the fresh payload hash fails.",
    prior: read("read-030", { path: "src/a.ts" }, text("alpha beta!"), { stat: sameStat }),
    current: read("read-031", { path: "src/a.ts" }, text("alpha zeta!"), { stat: sameStat }),
  },
  {
    name: "Line range shifted",
    event: "A line is inserted before the requested line range.",
    note: "The same offset/limit selection now returns different visible bytes.",
    prior: read("read-040", { path: "src/a.ts", offset: 2, limit: 2 }, text("two\nthree")),
    current: read("read-041", { path: "src/a.ts", offset: 2, limit: 2 }, text("one\ntwo")),
  },
  {
    name: "Atomic replacement, identical result",
    event: "The file is atomically replaced; inode and mtime change, bytes do not.",
    note: "Filesystem identity is irrelevant after a fresh exact payload match.",
    prior: read("read-050", { path: "src/a.ts" }, text("same bytes"), { stat: sameStat }),
    current: read("read-051", { path: "src/a.ts" }, text("same bytes"), {
      stat: { size: 12, mtime: "12:01:00.000", inode: 99 },
    }),
  },
  {
    name: "Symlink retarget, identical result",
    event: "The same symlink path points elsewhere but returns identical bytes.",
    note: "The selected Pi-visible result is unchanged; no file-identity claim is made.",
    prior: read("read-060", { path: "current.ts" }, text("same bytes"), {
      stat: { ...sameStat, inode: 41 },
    }),
    current: read("read-061", { path: "current.ts" }, text("same bytes"), {
      stat: { ...sameStat, inode: 88 },
    }),
  },
  {
    name: "Formatter changes bytes",
    event: "Formatting changes whitespace in the selected range.",
    note: "Known write events are not trusted; fresh payload comparison catches it.",
    prior: read("read-070", { path: "src/a.ts" }, text("const x=1;")),
    current: read("read-071", { path: "src/a.ts" }, text("const x = 1;")),
  },
  {
    name: "Deletion",
    event: "The fresh read fails after the file is deleted.",
    note: "Errors remain raw and do not replace the last successful baseline.",
    prior: read("read-080", { path: "src/a.ts" }, text("old bytes")),
    current: read("read-081", { path: "src/a.ts" }, text("ENOENT: no such file"), {
      isError: true,
      evidenceCommit: undefined,
    }),
  },
  {
    name: "Checkout restores older bytes",
    event: "The latest successful baseline is B; checkout restores older A.",
    note: "Compare only with the latest successful baseline, so restored A is shown raw once.",
    prior: read("read-090", { path: "src/a.ts" }, text("version B")),
    current: read("read-091", { path: "src/a.ts" }, text("version A")),
  },
  {
    name: "Current evidence commit fails",
    event: "Selection and payload match, but current-envelope evidence cannot commit.",
    note: "The current tool call cannot be recovered exactly, so fail open.",
    prior: read("read-100", { path: "src/a.ts" }, text("same bytes")),
    current: read("read-101", { path: "src/a.ts" }, text("same bytes"), {
      evidenceCommit: "failed",
    }),
  },
  {
    name: "Image processing changes payload",
    event: "The same image path produces a different processed image payload.",
    note: "Path and source-file identity cannot override Pi-visible payload mismatch.",
    prior: read("read-110", { path: "hero.png" }, [
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]),
    current: read("read-111", { path: "hero.png" }, [
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: "BBBB", mimeType: "image/png" },
    ]),
  },
  {
    name: "External edit after the read",
    event: "The current read returns matching bytes, then another process edits the file.",
    note: "Compaction describes the completed read observation, never future filesystem state.",
    prior: read("read-120", { path: "src/a.ts" }, text("observed bytes")),
    current: read("read-121", { path: "src/a.ts" }, text("observed bytes")),
  },
  {
    name: "Omitted then explicit first line",
    event: "The first read omits offset; the repeat explicitly uses offset=1.",
    note: "The accepted selection key normalizes an omitted offset to line one.",
    prior: read("read-130", { path: "src/a.ts" }, text("same bytes")),
    current: read("read-131", { path: "src/a.ts", offset: 1 }, text("same bytes")),
  },
  {
    name: "Different ranges, identical bytes",
    event: "Two different line ranges happen to contain identical text.",
    note: "Matching payloads cannot merge different read selections.",
    prior: read("read-140", { path: "src/a.ts", offset: 1, limit: 1 }, text("same")),
    current: read("read-141", { path: "src/a.ts", offset: 2, limit: 1 }, text("same")),
  },
  {
    name: "Truncation notice changes",
    event: "The visible prefix is unchanged, but the continuation coordinates change.",
    note: "The notice is part of the Pi-visible payload and prevents a false match.",
    prior: read(
      "read-150",
      { path: "large.ts" },
      text("same prefix\n\n[Showing lines 1-2000 of 3000. Use offset=2001 to continue.]"),
    ),
    current: read(
      "read-151",
      { path: "large.ts" },
      text("same prefix\n\n[Showing lines 1-2000 of 3001. Use offset=2001 to continue.]"),
    ),
  },
  {
    name: "Deletion then identical recreation",
    event: "An intervening failed read is followed by recreation with the earlier visible bytes.",
    note: "Errors stay visible but do not replace the last successful baseline.",
    prior: read("read-160", { path: "generated.ts" }, text("generated bytes")),
    current: read("read-162", { path: "generated.ts" }, text("generated bytes"), {
      stat: { size: 15, mtime: "12:05:00.000", inode: 120 },
    }),
  },
  {
    name: "Generator rewrites identical output",
    event: "Generation replaces the file but emits the same selected result.",
    note: "Fresh payload equality allows compaction despite the write operation.",
    prior: read("read-170", { path: "generated.ts" }, text("generated bytes"), {
      stat: { size: 15, mtime: "12:00:00.000", inode: 41 },
    }),
    current: read("read-171", { path: "generated.ts" }, text("generated bytes"), {
      stat: { size: 15, mtime: "12:06:00.000", inode: 121 },
    }),
  },
  {
    name: "Distinct invalid UTF-8, same visible text",
    event: "Different source byte sequences decode to the same replacement character.",
    note: "The protected boundary is Pi-visible UTF-8 content, not pre-decoding file bytes.",
    prior: read("read-180", { path: "invalid.txt" }, text("�")),
    current: read("read-181", { path: "invalid.txt" }, text("�")),
  },
  {
    name: "Unrecognized byte-range producer",
    event: "Another tool exposes byte ranges under a different producer contract.",
    note: "MVP fails open until that producer defines its own pinned selection semantics.",
    prior: read("bytes-190", { path: "blob.bin", offset: 1, limit: 8 }, text("12345678"), {
      producerContract: "custom-byte-read/v1",
    }),
    current: read("bytes-191", { path: "blob.bin", offset: 1, limit: 8 }, text("12345678"), {
      producerContract: "custom-byte-read/v1",
    }),
  },
  {
    name: "Parallel sibling read",
    event: "An identical sibling read completed during the same assistant turn.",
    note: "The turn-start baseline is frozen, so concurrent siblings cannot reference each other.",
    baselineUnavailableReason: "same-turn",
    current: read("read-201", { path: "src/a.ts" }, text("same bytes")),
  },
  {
    name: "LRU baseline evicted",
    event: "The matching selection was evicted under the observation-ledger memory bound.",
    note: "Eviction loses one compression hit only; the fresh result establishes a new baseline.",
    baselineUnavailableReason: "evicted",
    current: read("read-211", { path: "src/a.ts" }, text("same bytes")),
  },
];
