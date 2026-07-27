// THROWAWAY PROTOTYPE: model the proposed compression safety contract, not production behavior.

export type AmbiguousMatchPolicy = "lossless-generic" | "raw";
export type Fidelity =
  | "verified-lossless"
  | "verified-externally-recoverable"
  | "irreversibly-lossy";
export type Phase =
  | "received"
  | "static-eligibility"
  | "dynamic-matching"
  | "ownership"
  | "evidence"
  | "transform"
  | "cleanup"
  | "validation"
  | "committed"
  | "failed-open"
  | "recovery-error";

export type HistoryState = "original-pending" | "compact-immutable" | "original-fail-open";

export interface InputEnvelope {
  readonly tool: string;
  readonly isError: boolean;
  readonly payloadByteLength: number;
  readonly envelopeByteLength: number;
  readonly payloadHash: string;
  readonly envelopeHash: string;
  readonly canonicalizationVersion: "pi-tool-result-v1";
  readonly summary: string;
}

export interface PipelineState {
  readonly scenarioIndex: number;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly phase: Phase;
  readonly step: number;
  readonly done: boolean;
  readonly input: InputEnvelope;
  readonly staticCandidates: readonly string[];
  readonly matcherOutcomes: Readonly<Record<string, string>>;
  readonly owner: string | null;
  readonly requestedFidelity: Fidelity | "none";
  readonly evidence:
    | "not-required"
    | "staging"
    | "prepared"
    | "committed-pinned"
    | "aborted"
    | "invalid";
  readonly candidate: string | null;
  readonly recoverabilityValidation: string;
  readonly presentationValidation: string;
  readonly history: HistoryState;
  readonly recovery: "not-requested" | "verified" | "evidence_integrity_error";
  readonly diagnostics: readonly string[];
  readonly lastTransition: string;
  readonly ambiguousPolicy: AmbiguousMatchPolicy;
  readonly sessionFailureCounts: Readonly<Record<string, number>>;
  readonly disabledAdapters: readonly string[];
}

export type Action =
  | { readonly type: "advance" }
  | { readonly type: "next-scenario" }
  | { readonly type: "reset-result" }
  | { readonly type: "reset-session" }
  | { readonly type: "toggle-policy" }
  | { readonly type: "recover" };

interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly input: InputEnvelope;
  readonly recoveryResult?: "lossless-verified" | "external-verified" | "evidence_integrity_error";
  readonly steps: readonly Step[];
}

type Step = (state: PipelineState) => PipelineState;

type StatePatch = Partial<Omit<PipelineState, "step" | "done" | "lastTransition">>;

function transition(note: string, patch: StatePatch = {}): Step {
  return (state) => ({
    ...state,
    ...patch,
    step: state.step + 1,
    done: state.step + 1 >= scenarios[state.scenarioIndex].steps.length,
    lastTransition: note,
  });
}

function diagnosticTransition(event: string, note: string, patch: StatePatch = {}): Step {
  return (state) => ({
    ...transition(note, patch)(state),
    diagnostics: [...state.diagnostics, event],
  });
}

const textInput = (
  tool: string,
  summary: string,
  byteLength: number,
  isError = false,
): InputEnvelope => ({
  tool,
  isError,
  payloadByteLength: byteLength,
  envelopeByteLength: byteLength + 128,
  payloadHash: `sha256:payload-${tool}-${byteLength}`,
  envelopeHash: `sha256:envelope-${tool}-${byteLength + 128}`,
  canonicalizationVersion: "pi-tool-result-v1",
  summary,
});

const uniqueOwnerSteps: readonly Step[] = [
  transition("Static metadata produced one eligible adapter.", {
    phase: "static-eligibility",
    staticCandidates: ["vitest-output@100"],
  }),
  transition("The pure matcher accepted the immutable input.", {
    phase: "dynamic-matching",
    matcherOutcomes: { "vitest-output": "match@100" },
  }),
  transition("The unique highest-priority adapter became the specialized candidate owner.", {
    phase: "ownership",
    owner: "vitest-output",
  }),
];

const scenarios: readonly Scenario[] = [
  {
    id: "external-success",
    title: "Externally recoverable success",
    input: textInput("bash", "Vitest output: 1 failure among 2,400 tests", 2_400_000, true),
    recoveryResult: "external-verified",
    steps: [
      ...uniqueOwnerSteps,
      transition(
        "Core staged canonical envelope bytes, read them back, and verified both identities.",
        {
          phase: "evidence",
          evidence: "prepared",
          recoverabilityValidation: "staged bytes equal canonical envelope",
        },
      ),
      transition("The owner used the provisional receipt to produce one external candidate.", {
        phase: "transform",
        requestedFidelity: "verified-externally-recoverable",
        candidate: "TEST RUN: FAILED; 1 failure; evidence://ev_0198",
      }),
      transition("Independent presentation checks recomputed every visible claim.", {
        phase: "validation",
        presentationValidation: "typed facts and evidence reference verified",
      }),
      transition(
        "Core committed and pinned evidence, then bound its receipt into history metadata.",
        {
          phase: "evidence",
          evidence: "committed-pinned",
        },
      ),
      transition("Pi receives one replacement; history is now opaque and immutable.", {
        phase: "committed",
        history: "compact-immutable",
      }),
    ],
  },
  {
    id: "lossless-success",
    title: "Core-bundled lossless round-trip success",
    input: textInput("read", "Repeated source lines with reversible inline metadata", 48_000),
    recoveryResult: "lossless-verified",
    steps: [
      transition("No specialized adapter was eligible; the generic candidate owner was selected.", {
        phase: "static-eligibility",
        owner: "generic-core",
      }),
      transition("MVP policy allowed one approved core-bundled codec with a bundled decoder.", {
        phase: "ownership",
      }),
      transition("The owner produced one candidate with inline restoration metadata.", {
        phase: "transform",
        requestedFidelity: "verified-lossless",
        candidate: "line × 4000 {positions: …}",
      }),
      transition("The terminable restorer reconstructed the canonical payload exactly.", {
        phase: "validation",
        recoverabilityValidation: "direct byte equality passed",
      }),
      transition("Independent checks verified the final model-visible presentation.", {
        phase: "validation",
        presentationValidation: "typed fields and excerpts verified",
      }),
      transition("Versioned codec metadata and a compatible decoder lifetime were recorded.", {
        phase: "committed",
        history: "compact-immutable",
      }),
    ],
  },
  {
    id: "ambiguous-match",
    title: "Tied specialized adapters",
    input: textInput("bash", "Output resembles both Vite+ and Vitest", 90_000),
    steps: [
      transition("Static scopes admitted two candidates.", {
        phase: "static-eligibility",
        staticCandidates: ["vite-plus-output@100", "vitest-output@100"],
      }),
      transition("Both pure matchers accepted the untouched input at equal priority.", {
        phase: "dynamic-matching",
        matcherOutcomes: {
          "vite-plus-output": "match@100",
          "vitest-output": "match@100",
        },
      }),
      diagnosticTransition(
        "AMBIGUOUS_ADAPTER_MATCH",
        "No owner was awarded; order and registration cannot break the tie.",
        { phase: "ownership" },
      ),
      (state) =>
        transition(
          state.ambiguousPolicy === "raw"
            ? "Strict policy selected the untouched original."
            : "Default policy applied only lossless generic cleanup.",
          state.ambiguousPolicy === "raw"
            ? { phase: "failed-open", history: "original-fail-open" }
            : {
                phase: "validation",
                owner: "generic-core",
                requestedFidelity: "verified-lossless",
                candidate: "approved reversible generic representation",
                recoverabilityValidation: "generic round trip passed",
                presentationValidation: "generic presentation verified",
              },
        )(state),
      (state) =>
        state.ambiguousPolicy === "raw"
          ? transition("The original remains in history.", {
              phase: "failed-open",
              history: "original-fail-open",
            })(state)
          : transition("The lossless fallback entered immutable history.", {
              phase: "committed",
              history: "compact-immutable",
            })(state),
    ],
  },
  {
    id: "matcher-failure",
    title: "Eligible matcher times out",
    input: textInput("bash", "Dynamic command output", 120_000),
    steps: [
      transition("Static scopes admitted two candidate adapters.", {
        phase: "static-eligibility",
        staticCandidates: ["generic-test@20", "slow-specialist@200"],
      }),
      transition("One isolated matcher succeeded while the other timed out.", {
        phase: "dynamic-matching",
        matcherOutcomes: { "generic-test": "match@20", "slow-specialist": "timeout" },
      }),
      (state) => {
        const count = (state.sessionFailureCounts["slow-specialist"] ?? 0) + 1;
        const disabled = count >= 3;
        return {
          ...diagnosticTransition(
            "ADAPTER_MATCH_FAILURE",
            "A candidate matcher failed, so successful matchers cannot acquire ownership.",
            { phase: "ownership" },
          )(state),
          sessionFailureCounts: { ...state.sessionFailureCounts, "slow-specialist": count },
          disabledAdapters: disabled
            ? [...new Set([...state.disabledAdapters, "slow-specialist"])]
            : state.disabledAdapters,
          diagnostics: [
            ...state.diagnostics,
            "ADAPTER_MATCH_FAILURE",
            ...(disabled ? ["ADAPTER_DISABLED"] : []),
          ],
        };
      },
      (state) =>
        transition(
          state.ambiguousPolicy === "raw"
            ? "Strict policy returned the untouched original."
            : "Default policy used only verified lossless generic cleanup.",
          state.ambiguousPolicy === "raw"
            ? { phase: "failed-open", history: "original-fail-open" }
            : {
                phase: "committed",
                owner: "generic-core",
                requestedFidelity: "verified-lossless",
                candidate: "approved reversible generic representation",
                recoverabilityValidation: "generic round trip passed",
                presentationValidation: "generic presentation verified",
                history: "compact-immutable",
              },
        )(state),
    ],
  },
  {
    id: "adapter-timeout",
    title: "Selected adapter exceeds deadline",
    input: textInput("bash", "Large compiler output", 800_000, true),
    steps: [
      ...uniqueOwnerSteps,
      diagnosticTransition(
        "ADAPTER_TIMEOUT",
        "The terminable execution boundary exceeded its deadline; no second candidate owner may run.",
        { phase: "transform" },
      ),
      transition("The candidate was discarded and the failed original stayed failed.", {
        phase: "failed-open",
        history: "original-fail-open",
      }),
    ],
  },
  {
    id: "receipt-mismatch",
    title: "Evidence receipt mismatch",
    input: textInput("bash", "Output requiring external evidence", 500_000),
    steps: [
      ...uniqueOwnerSteps,
      diagnosticTransition(
        "EVIDENCE_INTEGRITY_FAILURE",
        "Read-back staged bytes differed from the locally computed canonical identity.",
        { phase: "evidence", evidence: "invalid" },
      ),
      transition("No transform ran; the exact original failed open.", {
        phase: "failed-open",
        history: "original-fail-open",
      }),
    ],
  },
  {
    id: "lossless-mismatch",
    title: "Core-bundled lossless restoration mismatch",
    input: textInput("read", "Source where whitespace was accidentally removed", 32_000),
    steps: [
      transition("The generic candidate owner selected an approved core-bundled codec.", {
        phase: "ownership",
        owner: "generic-core",
      }),
      transition("It requested lossless classification.", {
        phase: "transform",
        requestedFidelity: "verified-lossless",
        candidate: "compact source + restoration metadata",
      }),
      diagnosticTransition(
        "LOSSLESS_VERIFICATION_FAILURE",
        "Restored canonical payload differed; evidence cannot legitimize this candidate.",
        {
          phase: "validation",
          recoverabilityValidation: "direct byte equality failed",
          candidate: null,
        },
      ),
      transition("The invalid candidate was discarded completely.", {
        phase: "failed-open",
        history: "original-fail-open",
      }),
    ],
  },
  {
    id: "contradictory-external",
    title: "Recoverable but misleading candidate",
    input: textInput("bash", "Test output containing one failure", 300_000, true),
    steps: [
      ...uniqueOwnerSteps,
      transition("Core staged, read back, and verified the canonical envelope bytes.", {
        phase: "evidence",
        evidence: "prepared",
        recoverabilityValidation: "staged bytes verified",
      }),
      transition("The adapter proposed a recoverable but false summary: all tests passed.", {
        phase: "transform",
        requestedFidelity: "verified-externally-recoverable",
        candidate: "ALL TESTS PASSED; evidence://ev_false",
      }),
      diagnosticTransition(
        "CANDIDATE_PRESENTATION_FAILURE",
        "Independent validation found a model-visible claim contradicting the original.",
        {
          phase: "validation",
          presentationValidation: "contradiction detected",
          candidate: null,
        },
      ),
      transition("Prepared evidence was aborted; valid evidence never rescues false context.", {
        phase: "failed-open",
        evidence: "aborted",
        history: "original-fail-open",
      }),
    ],
  },
  {
    id: "failed-command",
    title: "Failed command safely compressed",
    input: textInput("bash", "Compiler exited 1 with 100 MB diagnostics", 100_000_000, true),
    steps: [
      ...uniqueOwnerSteps,
      transition("Core staged and read-back verified the complete failed-result envelope.", {
        phase: "evidence",
        evidence: "prepared",
        recoverabilityValidation: "staged bytes verified",
      }),
      transition("The adapter preserved failure status, exit status, excerpt, and reference.", {
        phase: "transform",
        requestedFidelity: "verified-externally-recoverable",
        candidate: "FAILED exit=1; diagnostic excerpt; evidence://ev_failure",
      }),
      transition("Independent checks recomputed all visible failure claims.", {
        phase: "validation",
        presentationValidation: "failure semantics verified",
      }),
      transition("Core committed and pinned evidence and bound the receipt into history.", {
        phase: "evidence",
        evidence: "committed-pinned",
      }),
      transition("The compact result entered immutable history and still reads as failed.", {
        phase: "committed",
        history: "compact-immutable",
      }),
    ],
  },
  {
    id: "oversized-fallback",
    title: "Oversized original when storage fails",
    input: textInput("custom-tool", "Untruncated 100 MB custom tool result", 100_000_000),
    steps: [
      transition("No specialized adapter was statically eligible.", {
        phase: "static-eligibility",
      }),
      transition("The generic candidate owner would require external evidence.", {
        phase: "ownership",
        owner: "generic-core",
      }),
      diagnosticTransition(
        "EVIDENCE_WRITE_FAILURE",
        "Evidence storage failed; an error marker would be irreversibly lossy.",
        { phase: "evidence", evidence: "invalid" },
      ),
      transition("The entire oversized original failed open despite downstream risk.", {
        phase: "failed-open",
        history: "original-fail-open",
      }),
    ],
  },
  {
    id: "recovery-corruption",
    title: "Evidence corrupts after a valid commit",
    input: textInput("bash", "Externally recoverable compiler output", 700_000, true),
    recoveryResult: "evidence_integrity_error",
    steps: [
      ...uniqueOwnerSteps,
      transition("Core staged and read-back verified the canonical envelope bytes.", {
        phase: "evidence",
        evidence: "prepared",
        recoverabilityValidation: "staged bytes verified",
      }),
      transition("The owner produced an external candidate preserving failure semantics.", {
        phase: "transform",
        requestedFidelity: "verified-externally-recoverable",
        candidate: "FAILED exit=1; evidence://ev_later_corrupt",
      }),
      transition("Independent checks verified the final model-visible presentation.", {
        phase: "validation",
        presentationValidation: "external candidate verified",
      }),
      transition("Core committed and pinned evidence and bound the receipt into history.", {
        phase: "evidence",
        evidence: "committed-pinned",
      }),
      transition("The compact result entered immutable history.", {
        phase: "committed",
        history: "compact-immutable",
      }),
    ],
  },
];

function initialForScenario(
  scenarioIndex: number,
  previous?: Pick<PipelineState, "ambiguousPolicy" | "sessionFailureCounts" | "disabledAdapters">,
): PipelineState {
  const scenario = scenarios[scenarioIndex];
  return {
    scenarioIndex,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    phase: "received",
    step: 0,
    done: false,
    input: scenario.input,
    staticCandidates: [],
    matcherOutcomes: {},
    owner: null,
    requestedFidelity: "none",
    evidence: "not-required",
    candidate: null,
    recoverabilityValidation: "not run",
    presentationValidation: "not run",
    history: "original-pending",
    recovery: "not-requested",
    diagnostics: [],
    lastTransition: "Received and froze one versioned canonical Pi-visible tool_result envelope.",
    ambiguousPolicy: previous?.ambiguousPolicy ?? "lossless-generic",
    sessionFailureCounts: previous?.sessionFailureCounts ?? {},
    disabledAdapters: previous?.disabledAdapters ?? [],
  };
}

export function createInitialState(): PipelineState {
  return initialForScenario(0);
}

export function scenarioCount(): number {
  return scenarios.length;
}

export function reduce(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case "advance": {
      const scenario = scenarios[state.scenarioIndex];
      const step = scenario.steps[state.step];
      return step ? step(state) : state;
    }
    case "next-scenario":
      return initialForScenario((state.scenarioIndex + 1) % scenarios.length, state);
    case "reset-result":
      return initialForScenario(state.scenarioIndex, state);
    case "reset-session":
      return initialForScenario(state.scenarioIndex, {
        ambiguousPolicy: state.ambiguousPolicy,
        sessionFailureCounts: {},
        disabledAdapters: [],
      });
    case "toggle-policy":
      return {
        ...state,
        ambiguousPolicy: state.ambiguousPolicy === "raw" ? "lossless-generic" : "raw",
        lastTransition: "Changed ambiguity and matcher-failure fallback policy.",
      };
    case "recover": {
      if (state.history !== "compact-immutable") {
        return { ...state, lastTransition: "Recovery is available only after compact commit." };
      }
      const result = scenarios[state.scenarioIndex].recoveryResult;
      if (!result) {
        return {
          ...state,
          lastTransition: "This result has no configured fidelity-specific recovery path.",
        };
      }
      if (result === "lossless-verified") {
        return {
          ...state,
          recovery: "verified",
          lastTransition:
            "Pinned decoder versions restored bytes matching the committed payload identity.",
        };
      }
      if (result === "external-verified") {
        return {
          ...state,
          recovery: "verified",
          lastTransition:
            "Retrieved evidence matched the receipt bound into immutable history metadata.",
        };
      }
      return {
        ...state,
        phase: "recovery-error",
        recovery: "evidence_integrity_error",
        diagnostics: [...state.diagnostics, "EVIDENCE_INTEGRITY_FAILURE"],
        lastTransition: "Recovery detected missing, truncated, or mismatched evidence.",
      };
    }
  }
}
