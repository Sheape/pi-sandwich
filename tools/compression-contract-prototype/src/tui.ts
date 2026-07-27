// THROWAWAY PROTOTYPE: terminal shell for manually driving the pure state machine.

import {
  createInitialState,
  reduce,
  scenarioCount,
  type Action,
  type PipelineState,
} from "./model.ts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

let state = createInitialState();

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "symbol") return value.description ?? "symbol";
  if (typeof value === "function") return value.name || "function";
  return "—";
}

function line(label: string, value: unknown): string {
  return `${bold}${label.padEnd(19)}${reset} ${renderValue(value)}`;
}

function render(current: PipelineState): void {
  process.stdout.write("\x1b[2J\x1b[H");
  const frame = [
    `${bold}PI SANDWICH — COMPRESSION CONTRACT PROTOTYPE${reset}`,
    `${dim}THROWAWAY · scenario ${current.scenarioIndex + 1}/${scenarioCount()} · ${current.scenarioId}${reset}`,
    "",
    line("Scenario", current.scenarioTitle),
    line("Phase", `${current.phase} (${current.step}${current.done ? ", complete" : ""})`),
    line(
      "Input",
      `${current.input.tool}; payload=${current.input.payloadByteLength}; envelope=${current.input.envelopeByteLength}; isError=${current.input.isError}`,
    ),
    line("Canonicalization", current.input.canonicalizationVersion),
    line("Input summary", current.input.summary),
    line("Static candidates", current.staticCandidates),
    line("Matcher outcomes", current.matcherOutcomes),
    line("Candidate owner", current.owner),
    line("Requested fidelity", current.requestedFidelity),
    line("Evidence", current.evidence),
    line("Candidate", current.candidate),
    line("Recoverability", current.recoverabilityValidation),
    line("Presentation", current.presentationValidation),
    line("History", current.history),
    line("Recovery", current.recovery),
    line("Diagnostics", current.diagnostics),
    line("Failure counts", current.sessionFailureCounts),
    line("Disabled adapters", current.disabledAdapters),
    line("Fallback policy", current.ambiguousPolicy),
    "",
    `${bold}Last transition${reset}`,
    current.lastTransition,
    "",
    `${bold}n${reset}${dim} next${reset}  ${bold}s${reset}${dim} scenario${reset}  ${bold}r${reset}${dim} reset result${reset}  ${bold}x${reset}${dim} reset session${reset}  ${bold}p${reset}${dim} policy${reset}  ${bold}e${reset}${dim} recover${reset}  ${bold}q${reset}${dim} quit${reset}`,
  ];
  process.stdout.write(`${frame.join("\n")}\n`);
}

function actionForKey(key: string): Action | "quit" | null {
  switch (key) {
    case "n":
    case " ":
      return { type: "advance" };
    case "s":
      return { type: "next-scenario" };
    case "r":
      return { type: "reset-result" };
    case "x":
      return { type: "reset-session" };
    case "p":
      return { type: "toggle-policy" };
    case "e":
      return { type: "recover" };
    case "q":
    case "\u0003":
      return "quit";
    default:
      return null;
  }
}

function quit(): never {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write("\x1b[2J\x1b[H");
  process.exit(0);
}

function handle(data: string): void {
  for (const key of data) {
    const action = actionForKey(key);
    if (action === "quit") quit();
    if (action) {
      state = reduce(state, action);
      render(state);
    }
  }
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", handle);
render(state);
