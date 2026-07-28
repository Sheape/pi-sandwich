import { createHash } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { dummyEvidence, searchEvidence, type SearchBudget, type SearchRequest } from "./search.ts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";
const records = dummyEvidence();
const scenarios = [
  { name: "ordinary success", request: { query: "tests passed" } },
  { name: "failed result only", request: { query: "TypeError", isError: true } },
  { name: "same literal in different tools", request: { query: "shared marker" } },
  { name: "repeated literal + corrupt record", request: { query: "needle" } },
  { name: "no match", request: { query: "does not exist" } },
] satisfies Array<{ name: string; request: SearchRequest }>;
const limits = [1, 2, 3];
const recordBudgets = [1, 2, 4, 100];
const toolFilters = [undefined, "bash", "read", "semantic_query"];
const errorFilters = [undefined, false, true];

let scenarioIndex = 3;
let limitIndex = 1;
let budgetIndex = 2;
let toolFilterIndex = 0;
let errorFilterIndex = 0;
let cursor: string | undefined;
let response = run(false);

function request(): SearchRequest {
  return {
    ...scenarios[scenarioIndex]!.request,
    limit: limits[limitIndex],
    toolName: toolFilters[toolFilterIndex],
    isError: errorFilters[errorFilterIndex] ?? scenarios[scenarioIndex]!.request.isError,
    contentType: "text",
    ...(cursor ? { cursor } : {}),
  };
}

function budget(): SearchBudget {
  return { maxRecords: recordBudgets[budgetIndex]!, maxBytes: 4_096 };
}

function run(continueFromCursor: boolean) {
  if (continueFromCursor) cursor = response?.nextCursor;
  else cursor = undefined;
  return searchEvidence(records, request(), budget());
}

function shortRef(ref: string) {
  return `${ref.slice(0, 34)}…${ref.slice(-8)}`;
}

function render() {
  console.clear();
  console.log(`${bold}THROWAWAY PROTOTYPE — sandwich_evidence_search${reset}`);
  console.log(
    `${dim}Question: Does literal, verified, one-match-per-record search stay understandable when results, scans, corruption, and pagination are all bounded?${reset}\n`,
  );

  console.log(`${bold}Dummy evidence store${reset}`);
  for (const record of records) {
    const valid = record.receipt.envelope.sha256 === shortHash(record);
    const text = record.envelope.content.find((block) => block.type === "text")?.text ?? "<image>";
    console.log(
      `${valid ? "✓" : "✗"} ${record.receipt.storage.committedAt.slice(11, 19)} ${record.receipt.source.toolName.padEnd(14)} ${record.receipt.source.isError ? "error" : "ok   "} ${shortRef(record.receipt.ref)} ${dim}${text.replaceAll("\n", " ↵ ").slice(0, 48)}${reset}`,
    );
  }

  console.log(`\n${bold}Tool call${reset}  ${dim}${scenarios[scenarioIndex]!.name}${reset}`);
  console.log(JSON.stringify(request(), undefined, 2));
  console.log(`${bold}Internal scan budget${reset} ${JSON.stringify(budget())}`);

  console.log(`\n${bold}Tool result${reset}`);
  console.log(
    `complete=${response.complete}  stopReason=${response.stopReason}  scanned=${response.scanned.records} records/${response.scanned.bytes} bytes  integrityFailures=${response.integrityFailures}`,
  );
  for (const [index, result] of response.results.entries()) {
    console.log(
      `\n${index + 1}. ${result.toolName} ${result.isError ? "(error)" : "(ok)"} ${shortRef(result.ref)}`,
    );
    console.log(
      `   block=${result.block} match=${result.match.start}:${result.match.end} excerpt=${result.excerpt.start}:${result.excerpt.end}`,
    );
    console.log(`   ${JSON.stringify(result.excerpt.text)}`);
  }
  if (response.results.length === 0) console.log(`${dim}<no matches in this bounded page>${reset}`);
  console.log(
    `nextCursor=${response.nextCursor ? `${response.nextCursor.slice(0, 34)}…` : "<none>"}`,
  );

  console.log(`\n${bold}Controls${reset}`);
  console.log(
    `${bold}1-5${reset} scenario  ${bold}s${reset} continue cursor  ${bold}r${reset} restart  ${bold}t${reset} tool filter  ${bold}e${reset} error filter  ${bold}l${reset} result limit  ${bold}b${reset} scan budget  ${bold}q${reset} quit`,
  );
}

function shortHash(record: (typeof records)[number]) {
  return createHash("sha256")
    .update(Buffer.from(JSON.stringify(record.envelope)))
    .digest("hex");
}

function selectScenario(index: number) {
  scenarioIndex = index;
  toolFilterIndex = 0;
  errorFilterIndex = 0;
  response = run(false);
}

function demo() {
  for (const [index, scenario] of scenarios.entries()) {
    scenarioIndex = index;
    response = run(false);
    console.log(`\n=== ${scenario.name} ===`);
    console.log(JSON.stringify({ call: request(), result: response }, undefined, 2));
  }
}

if (process.argv.includes("--demo") || !process.stdin.isTTY) {
  demo();
} else {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (_text, key) => {
    if (key.ctrl && key.name === "c") process.exit();
    if (/^[1-5]$/.test(key.name ?? "")) selectScenario(Number(key.name) - 1);
    else if (key.name === "s" && response.nextCursor) response = run(true);
    else if (key.name === "r") response = run(false);
    else if (key.name === "t") {
      toolFilterIndex = (toolFilterIndex + 1) % toolFilters.length;
      response = run(false);
    } else if (key.name === "e") {
      errorFilterIndex = (errorFilterIndex + 1) % errorFilters.length;
      response = run(false);
    } else if (key.name === "l") {
      limitIndex = (limitIndex + 1) % limits.length;
      response = run(false);
    } else if (key.name === "b") {
      budgetIndex = (budgetIndex + 1) % recordBudgets.length;
      response = run(false);
    } else if (key.name === "q") process.exit();
    render();
  });
  render();
}
