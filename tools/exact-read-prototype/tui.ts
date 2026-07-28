import { emitKeypressEvents } from "node:readline";
import {
  advance,
  evaluate,
  payloadIdentity,
  PRODUCER_CONTRACT,
  reset,
  scenarios,
  selectionIdentity,
  type PrototypeState,
} from "./model.ts";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const resetStyle = "\x1b[0m";

let state: PrototypeState = reset(0);

const shortHash = (hash: string) => `${hash.slice(0, 12)}…`;
const status = (value: boolean | undefined) =>
  value === undefined
    ? `${dim}pending${resetStyle}`
    : value
      ? `${green}pass${resetStyle}`
      : `${red}fail${resetStyle}`;

function renderObservation(
  label: string,
  observation: (typeof scenarios)[number]["current"] | undefined,
) {
  console.log(`\n${bold}${label}${resetStyle}`);
  if (!observation) {
    console.log(`${dim}<none>${resetStyle}`);
    return;
  }
  const selection = selectionIdentity(observation);
  const payload = payloadIdentity(observation);
  console.log(`call=${observation.toolCallId}  error=${observation.isError}`);
  console.log(`selection=${JSON.stringify(selection)}`);
  console.log(`payload=${payload.bytes} B sha256:${shortHash(payload.sha256)}`);
  console.log(
    `stat hint=${observation.stat ? JSON.stringify(observation.stat) : "<not exposed>"} ${dim}(never authoritative)${resetStyle}`,
  );
}

function render() {
  const scenario = scenarios[state.scenario]!;
  const result = evaluate(scenario, state.stage);
  console.clear();
  console.log(`${bold}THROWAWAY PROTOTYPE — exact repeated-read identity${resetStyle}`);
  console.log(
    `${dim}Question: Does fresh execution + same normalized selection + exact canonical payload identity + current evidence safely replace a repeated Pi-visible read result?${resetStyle}`,
  );
  console.log(
    `\n${bold}Scenario ${state.scenario + 1}/${scenarios.length}: ${scenario.name}${resetStyle}`,
  );
  console.log(`${scenario.event}\n${dim}${scenario.note}${resetStyle}`);
  console.log(`${bold}Stage:${resetStyle} ${state.stage}`);

  renderObservation("Prior successful baseline", scenario.prior);
  if (state.stage !== "baseline") renderObservation("Fresh current read", scenario.current);

  console.log(`\n${bold}Checks${resetStyle}`);
  console.log(
    `fresh underlying read executed: ${state.stage === "baseline" ? `${dim}pending${resetStyle}` : `${green}pass${resetStyle}`}`,
  );
  console.log(`same normalized selection:      ${status(result.sameSelection)}`);
  console.log(`same canonical payload tuple:   ${status(result.samePayload)}`);
  const evidenceReached = state.stage === "evidence" || state.stage === "outcome";
  const evidenceNeeded =
    scenario.prior !== undefined &&
    scenario.current.producerContract === PRODUCER_CONTRACT &&
    !scenario.current.isError &&
    result.sameSelection === true &&
    result.samePayload === true;
  const evidenceStatus = !evidenceReached
    ? `${dim}pending${resetStyle}`
    : !evidenceNeeded
      ? `${dim}not needed${resetStyle}`
      : scenario.current.evidenceCommit === "ok"
        ? `${green}pass${resetStyle}`
        : `${red}fail${resetStyle}`;
  console.log(`current evidence commit:        ${evidenceStatus}`);

  console.log(`\n${bold}Outcome${resetStyle}`);
  const outcomeColor = result.outcome.startsWith("compact")
    ? green
    : result.outcome === "pending"
      ? yellow
      : red;
  console.log(`${outcomeColor}${result.outcome}${resetStyle}  baseline=${result.baselineEffect}`);
  if (result.compactText) console.log(`\n${result.compactText}`);

  console.log(`\n${bold}Controls${resetStyle}`);
  console.log(
    `${bold}space${resetStyle} next stage  ${bold}a${resetStyle} resolve  ${bold}r${resetStyle} reset  ${bold}n/p${resetStyle} scenario  ${bold}q${resetStyle} quit`,
  );
}

function selectScenario(delta: number) {
  const scenario = (state.scenario + delta + scenarios.length) % scenarios.length;
  state = reset(scenario);
}

function runNonInteractive() {
  console.log("THROWAWAY PROTOTYPE — exact repeated-read scenario matrix\n");
  for (const [index, scenario] of scenarios.entries()) {
    const result = evaluate(scenario, "outcome");
    console.log(`${String(index + 1).padStart(2)}. ${scenario.name}: ${result.outcome}`);
  }
}

if (!process.stdin.isTTY) {
  runNonInteractive();
} else {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", (_text, key) => {
    if (key?.name === "q" || (key?.ctrl && key.name === "c")) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      console.clear();
      return;
    }
    if (key?.name === "space") state = advance(state);
    if (key?.name === "a") state = { ...state, stage: "outcome" };
    if (key?.name === "r") state = reset(state.scenario);
    if (key?.name === "n" || key?.name === "right") selectScenario(1);
    if (key?.name === "p" || key?.name === "left") selectScenario(-1);
    render();
  });
  render();
}
