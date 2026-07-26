# Serena output model without Serena workflow policy

**Status:** ADR-ready research note for [issue #15](https://github.com/Sheape/pi-sandwich/issues/15)  
**Decision target:** Serena v1.6.1 (`bcac0969fb8685783ea6d0f2642468fcc47e6395`), MCP protocol 2025-11-25  
**Recommendation:** Defer a dedicated Serena adapter from MVP. Use generic, lossless structured-result externalization; revisit a small parser-only adapter only after captured production results show material incremental savings.

## Decision

Do **not** import Serena's workflow, refactoring, memory, or tool-selection policy. Core may treat Serena like any MCP producer: retain immutable raw evidence, capture invocation identity externally, and externalize large payloads while preserving exact inline identifiers and locations. It may parse recognized symbol/reference payloads only to create reversible views.

A future Serena adapter is permitted only as an optional, fail-open parser for explicitly recognized tool names and observed schemas. It must not invoke tools, choose symbols, require reads before edits, orchestrate refactors, assess quality, manage memories, or add Serena instructions.

## Primary-source baseline

Serena v1.6.1 is the tagged package version and pins `mcp==1.28.1`; Serena's package reports MIT licensing, and the repository LICENSE grants use, modification, distribution, and sublicensing subject to preserving notice.[^version][^license] Findings below use the immutable v1.6.1 commit, not moving `main`.

Serena exposes `find_symbol` and `find_referencing_symbols` as language-server-backed symbolic-read tools.[^symbol-tools] The public MCP descriptions are generated from Python signatures/docstrings; both implementations return `str`, serialize their own payload with JSON, and may instead return human-readable shortening messages.[^find-symbol][^find-refs][^limit] Serena then mounts those functions through FastMCP. Depending on context, FastMCP may expose structured output; Serena explicitly allows `true`, `false`, or auto, and disables it for Claude Code.[^mcp-wrapper][^structured-config]

MCP itself guarantees only the tool-result envelope: unstructured `content`, optional JSON-object `structuredContent`, optional `outputSchema`, and `isError` execution failures. When structured content is returned, compatibility text should also be returned.[^mcp-tools] JSON-RPC request IDs correlate requests and responses, while protocol/version and implementation details are negotiated during initialization.[^mcp-schema][^mcp-lifecycle]

## Observed v1.6.1 results

I ran the tagged server from source with `uv run ... serena start-mcp-server`, `ide` context, `planning` mode, stdio transport, and a disposable two-file Python project. The initialize result said `protocolVersion: "2025-11-25"`, `serverInfo.name: "Serena"`, and `serverInfo.version: "1.28.1"`. That last value matches the pinned MCP SDK, **not** Serena's `1.6.1`; Serena's reliable release marker was CLI output `Serena 1.6.1-bcac0969`.[^version][^server-construction]

`tools/list` advertised each relevant `outputSchema` only as `{result: string}`. Successful calls contained both `content[0].text` and `structuredContent.result`, with the semantic JSON double-encoded as a string.

### Symbol search

Two identical calls with arguments `{"name_path_pattern":"Greeter/greet","relative_path":"lib.py"}` returned byte-identical semantic payloads:

```json
[
  {
    "name_path": "Greeter/greet",
    "kind": "Method",
    "relative_path": "lib.py",
    "body_location": { "start_line": 1, "end_line": 2 }
  }
]
```

No match returned successful `[]`. A depth-one class query returned a flat top-level list whose `children` had been regrouped by kind:

```json
[
  {
    "name_path": "Greeter",
    "kind": "Class",
    "relative_path": "lib.py",
    "body_location": { "start_line": 0, "end_line": 2 },
    "children": {
      "Method": [{ "name": "greet", "body_location": { "start_line": 1, "end_line": 2 } }]
    }
  }
]
```

This matches source: top-level `find_symbol` remains a list; child records are grouped by `kind`; emitted fields are `name_path`, `kind`, `relative_path`, `body_location`, optional `children`, `body`, and optional `info`.[^find-symbol][^output-dict] The same top-level and reference grouping declarations exist in v1.0.0 and v1.6.1, useful compatibility evidence but not a published semantic-output contract.[^v1-shapes]

### References and “impact”

`find_referencing_symbols` for `Greeter/greet` returned:

```json
{
  "main.py": {
    "Function": [
      {
        "name_path": "run",
        "body_location": { "start_line": 3, "end_line": 5 },
        "content_around_reference": "..."
      }
    ]
  }
}
```

No references returned `{}`, not `[]`. Results are grouped first by `relative_path`, then `kind`; leaves identify the **containing symbol** and include a display snippet.[^find-refs] Serena internally has zero-based reference line and character, but the normal full result does not emit either; `reference_line` appears only in a shortened fallback and character is omitted.[^reference-location] Therefore this is a one-hop reference view, not a stable impact graph. The v1.6.1 tool set has no dedicated impact/call/dependency-graph result contract; graph construction would be new product semantics, not normalization.[^official-tools]

### Identifiers and locations

- `name_path` is scoped within one source file. `/` separates ancestors; overloaded symbols append a zero-based `[i]`. It is not globally unique alone.[^find-symbol]
- For tool round trips, the practical identifier is `(relative_path, name_path)`; `kind` is useful validation. Internal Serena location identity is `(relative_path, line, column)`, and source says it uniquely identifies a symbol, but standard search output omits identifier column and exposes body line bounds instead.[^location]
- `body_location.start_line/end_line` are LSP-derived zero-based line bounds. They locate a body range, not the exact identifier token; values may be `null` for unsupported symbol kinds.[^output-dict][^location]
- Paths are project-relative and platform-normalized internally. Consumers must preserve original strings rather than rewriting separators.[^location]

### Query identity and repeated calls

Semantic results do not echo tool name, arguments, project identity, request ID, backend/language-server version, Serena release, or source revision. Repeated unchanged queries were identical in the probe, but references depend on language-server indexing and file synchronization; v1.6.1's changelog itself records a fix for stale reference results after external filesystem changes.[^changelog]

Consequently, query identity must be owned by Sandwich evidence metadata: canonicalized `(server instance, project/root identity, tool name, exact arguments, invocation ordinal, observed Serena CLI version/config fingerprint, MCP protocol version)`. JSON-RPC `id` is transport correlation only, not a reusable semantic-query ID.[^mcp-schema]

### Failures and non-JSON variants

Observed missing required input produced `isError: true` with Pydantic validation text. Referencing a missing symbol produced `isError: true` with `ValueError: No symbol matching ... found`; symbol search for the same missing name was successful `[]`. Serena intentionally converts internal exceptions to MCP tool errors.[^errors]

Shape recognition must also account for valid non-JSON success text:

- `Matched N>max_matches=... symbols.\nShortened result:\n{...}`;
- `The answer is too long ...` followed by progressively reduced JSON or prose;
- references shortened to JSON without snippets, per-file counts, or only `Found N references.`.[^find-symbol][^find-refs][^limit]

These are lossy producer-side variants. Sandwich must never pretend they are complete graphs.

## Safe ownership boundary

### Safe, reversible operations

1. **Envelope normalization:** select `structuredContent.result` when it is a string; otherwise use the single text block. Parse JSON only when the entire string parses and recognized invariants hold. Preserve raw envelope and semantic string as immutable evidence.
2. **Externalization:** move large `body`, `info`, and `content_around_reference` values to evidence storage; leave stable references plus `relative_path`, `name_path`, `kind`, exact `body_location`, cardinality, and recovery pointer inline.
3. **Grouping views:** regroup symbol lists by file/kind or flatten Serena's file/kind maps for display, provided original order, keys, and raw payload remain recoverable. Grouping is a view, not canonical identity.
4. **Deduplication:** deduplicate only byte-identical complete records, retain count and original ordinals, and never merge merely because `(relative_path,name_path)` matches. Multiple usages can share one containing symbol; snippets/occurrence positions may differ or be absent.
5. **Unknown/shortened/failure handling:** pass through unchanged. Record `isError`, producer shortening text, parse failure, schema fingerprint, and version observations.

### Prohibited policy

Sandwich must not:

- decide which symbol or Serena tool to call;
- enforce overview/read-before-edit sequences or tool-selection priority;
- invoke rename/move/delete/refactor tools or infer refactor plans from references;
- synthesize impact edges, transitive closure, risk, or quality judgments;
- enforce verification/review/completion policy;
- read, write, curate, summarize, or inject Serena memories/instructions;
- enable/disable Serena tools, contexts, modes, onboarding, or workflow prompts.

Those belong to Serena, the coding agent, or external workflow/quality systems. Serena's own contexts contain explicit tool-selection guidance, demonstrating why output parsing and workflow policy must remain separate.[^ide-context]

## Adapter decision and fallback strategy

**Defer dedicated adapter from MVP.** Evidence supports useful fields, but not enough adapter value or contract stability:

- generic externalization already captures the largest values (`body`, `info`, snippets);
- MCP exposes only `result: string`, so semantic parsing relies on implementation details;
- context changes envelope behavior;
- producer-side shortening changes JSON to mixed prose and can discard exact occurrences;
- no semantic query ID, Serena release marker in results, exact identifier columns, or graph contract exists;
- reference completeness varies with backend/index state.

Revisit only if telemetry shows Serena payloads are common and parser-aware inline identity materially reduces tokens or recovery calls beyond generic externalization. Then ship an optional parser-only adapter with this gate:

1. explicit allowlist: `find_symbol`, `find_referencing_symbols` (backend-specific tools require separate evidence);
2. record externally verified Serena version and MCP protocol; do not interpret `serverInfo.version` as Serena version;
3. fingerprint `tools/list` input/output schemas plus envelope mode;
4. accept only documented/observed invariants above; retain unknown fields;
5. preserve raw evidence before transformation;
6. fail open on mixed prose, unknown roots/leaf types, missing identifiers, errors, or version/schema drift;
7. no graph construction and no policy side effects.

### ADR-ready wording

> **Decision:** Exclude a dedicated Serena adapter from the first publishable release. Apply generic immutable evidence externalization to Serena results. Permit later opt-in parser-only normalization for verified symbol-search and reference shapes, keyed by external invocation/version/schema metadata and failing open to the original result. Keep Serena workflow, refactoring, memory, quality, and tool-selection policy outside Sandwich.
>
> **Consequences:** MVP avoids coupling to an implementation-detail JSON string and avoids importing agent policy. It forgoes Serena-specific compact grouping initially. Raw evidence and telemetry preserve a migration path; a later adapter can add reversible views without changing core ownership.

## Caveats

Probe covers v1.6.1, stdio, FastMCP 1.28.1, `ide` context, LSP/Python backend, and a small project. JetBrains-specific tools have separate DTOs/groupers and were not verified. Cross-language line/body behavior and backend reference completeness vary. Source comparison confirms core grouping declarations from v1.0.0 through v1.6.1, not a compatibility promise. No impact-graph output was accessible because v1.6.1 exposes no such tool contract.

[^version]: [Serena v1.6.1 package metadata and MCP pin](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/pyproject.toml#L5-L24) and [runtime version marker](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/__init__.py#L1-L18).

[^license]: [Serena MIT LICENSE](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/LICENSE).

[^symbol-tools]: [Official Serena tools documentation](https://oraios.github.io/serena/01-about/035_tools.html).

[^find-symbol]: [`FindSymbolTool` implementation and result shaping](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools/symbol_tools.py#L134-L249).

[^find-refs]: [`FindReferencingSymbolsTool` grouping and shortening](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools/symbol_tools.py#L252-L341).

[^limit]: [Serena result-length fallbacks and JSON serialization](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools/tools_base.py#L284-L313).

[^mcp-wrapper]: [Serena FastMCP wrapper](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/mcp.py#L53-L145).

[^structured-config]: [Context-level structured-output setting](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/config/context_mode.py#L177-L190) and [Claude Code override](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/resources/config/contexts/claude-code.yml#L51-L56).

[^mcp-tools]: [MCP 2025-11-25 tool results, schemas, and errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

[^mcp-schema]: [MCP 2025-11-25 JSON-RPC and request-ID schema](https://modelcontextprotocol.io/specification/2025-11-25/schema#jsonrpc).

[^mcp-lifecycle]: [MCP 2025-11-25 lifecycle/version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

[^server-construction]: [Serena FastMCP server construction](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/mcp.py#L374-L387).

[^output-dict]: [Symbol output fields and `to_dict`](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/symbol.py#L420-L545).

[^v1-shapes]: [v1.0.0 symbol tools](https://github.com/oraios/serena/blob/f65980bd8cb9d71d744f1fb06cae9018902bdf4e/src/serena/tools/symbol_tools.py#L122-L323) compared with [v1.6.1](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools/symbol_tools.py#L134-L341).

[^reference-location]: [Reference location is zero-based internally](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/symbol.py#L550-L573).

[^official-tools]: [v1.6.1 Serena tool source tree](https://github.com/oraios/serena/tree/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools) and [official generated tool list](https://oraios.github.io/serena/01-about/035_tools.html).

[^location]: [Serena symbol-location identity](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/symbol.py#L25-L58) and [name-path construction](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/symbol.py#L347-L358).

[^changelog]: [v1.6.1 changelog: stale reference fix](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/CHANGELOG.md#L20-L26).

[^errors]: [Serena exception-to-tool-error boundary](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/tools/tools_base.py#L330-L435) and [MCP wrapper conversion](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/mcp.py#L93-L101).

[^ide-context]: [Serena IDE context policy](https://github.com/oraios/serena/blob/bcac0969fb8685783ea6d0f2642468fcc47e6395/src/serena/resources/config/contexts/ide.yml).
