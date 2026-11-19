# Create Design Library

> Main workflow: Generate a complete Design Library from a Design Spec Bundle.
> Read when: User provides a parsed design-spec ZIP bundle and requests Library generation.

## Phase Overview

| Phase | Executor | Output | Parallelism |
|-------|----------|--------|-------------|
| 0 — Input Confirmation | Main Agent | Confirmed bundle path + output_dir + tmp_dir | — |
| 1 — Manifest Read | Main Agent | Index awareness + shortlist (from manifest) | — |
| 2 — Brand Analysis + Token Gen | Sub-Agent ×2 + Main Agent | Brand profile + Token CSS + css.json → output_dir | Cmd (file copy) then 2 parallel Tasks then Cmd (css-to-json) |
| 2.7 — UIKit Plan Generation | Main Agent (deterministic script, no Task) | `{output_dir}/uikit-plan.json` from compact component evidence | — |
| 3 — Component Synthesis | Sub-Agent batches | intent JSON + preview HTML for core preview components | ≤3 parallel per batch |
| 4a — Documentation | Sub-Agent ×2 | SKILL.md + README.md | 2 parallel |
| 4b — UIKit Showcase | Sub-Agent ×1 | ui_kits/{type}/index.html | 1 sequential (after 4a) |
| 5 — Quality Gate & Complete | Main Agent | Validation + complete + cleanup tmp_dir | — |

> **Template Rule (all dispatch phases)**: For every Task dispatch, read the matching phase template from `examples/templates/`, fill actual paths/data, and preserve embedded `⚠️ HARD RULES`. Normal create-library execution uses `SKILL.md` Runtime Fast Path; read `operation-policies/agent-orchestration.md` only for fallback/debug cases.

---

## Phase 0 — Input Confirmation (Main Agent)

> **User output**: zh: "已收到你的设计规范，开始分析..." / en: "Got your design spec. Starting analysis..." — or when input missing: zh: "请提供设计规范文件，我来为你生成设计系统。" / en: "Please provide your design spec to start generating the Design Library." (NEVER say bundle/压缩包/规范包/ZIP — see `user-output-policy.md` § Terminology Rules)

1. Confirm bundle exists (ZIP attachment or unpacked directory).
2. If not present, ask user to provide the design-spec bundle.
3. Extract bundle root path for subsequent phases.
4. Do NOT read any bundle files yet — only confirm path.
5. Derive paths:
   - `{output_dir}` = `{workspace}/.design_library/{library_name}/` — `{workspace}` is the user's current workspace root; `{library_name}` is extracted from bundle metadata (`context/import-context.md`) or user instruction.
   - `{tmp_dir}` = `{hidden_tmp_dir}/{library_name}/` — a non-user-visible temporary workspace for intermediates. `{hidden_tmp_dir}` is a writable, deletable hidden temp area provided by the runtime. MUST NOT be `{output_dir}_tmp` or any visible folder inside the user's workspace.
6. Create `{tmp_dir}` directory.

> **Directory Separation**: `{output_dir}` contains ONLY final deliverables. `{tmp_dir}` holds intermediate files consumed during generation. Phase 5 cleans up `{tmp_dir}` after successful validation.
>
> **⚠️ HARD RULE — Write Scope Constraint**: Writing ANY file (data, scripts, logs, temp artifacts) to paths outside `{output_dir}` and `{tmp_dir}` is **FORBIDDEN**. This explicitly includes one-off helper scripts (e.g., `parse_forms.py`, `transform.mjs`). On device (Lite), files outside the allowed paths trigger user-facing delete-confirmation dialogs that break the experience. If you need a scratch script, write it to `{tmp_dir}/` and execute from there.

### User-Directed Skip Set

> **SSOT**: See `SKILL.md` § Skip Set for signal table and dependency rules.

Parse user request per SKILL.md signal table → construct `skipSet`.

**Priority**: Bundle-driven Token-Only detection (`shortlist empty`) takes PRECEDENCE over user signals. User-directed skip only ADDS to the skip set, never removes from it. If the bundle has component data but user says "不要组件", honor the user's opt-out.

### TodoWrite Policy (HARD LIMIT — exceeding = orchestration failure)

| Rule | Detail |
|------|--------|
| **HARD CAP = 4** | Maximum 4 TodoWrite calls in entire session |
| **Allowed positions** | Phase 0→1, Phase 1→2, Phase 2→3, Phase 4a→4b/5 ONLY |
| **Forbidden positions** | Phase 3 internal batch transitions, Phase 3→4, Phase 5 internal steps |
| **Batch with actions** | TodoWrite MUST share the tool call batch with the next action (NEVER standalone) |
| **Sub-steps are NOT todos** | "Read file X", "Generate CSS" are NEVER todo items. Only "Phase N: {name}" |
| **Self-check** | If TodoWrite is the only tool in your response → VIOLATION → delete it and proceed |
| **Observability substitute** | None in default silent mode. Phase transitions stay silent unless verbose/debug mode is explicitly requested. |

**Detection**: If TodoWrite count reaches 4 → CEASE all further TodoWrite for remainder of session.

---

## Phase 1 — Manifest Read (Main Agent)

**Purpose**: Load pre-computed index from bundle manifest (single Read).

**Step 1 — Read INDEX** (routing entry):
- `{bundle_path}/INDEX`

The INDEX file is your **mandatory first read**. It:
1. Routes you to the primary data sources (manifest, theme)
2. Explains the **JSONL Reading Strategy** — how to read line 0 (meta) first, then selectively load only the lines you need by offset
3. Lists all available generated files for deeper exploration

**JSONL Reading Rule** (from INDEX):
- **Full-read**: manifest, brand-input, design-tokens, annotations-summary — these are critical decision/generation data, read entirely.
- **Meta-first**: `components/index.jsonl` and `components/{slug}.jsonl` — read line 0 (meta) first to see component count, variant count, and complexity. Then decide which components and which lines to read based on shortlist and task needs. This avoids loading irrelevant variant data.

**Step 2 — Read Manifest**:
- `{bundle_path}/generated/bundle-manifest.jsonl`

This manifest is deterministically generated by BundleGenerator and contains:
- `stats` — file count, token count, component/variant counts, icon/page counts
- `shortlist` — pre-computed component list (filtered, sorted by variantCount, no hard cap)
- `validFiles` — categorized file paths (tokens, components, assets, context, pages, annotations)
- `previewAvailability` — document-level preview availability
- `generated/uikit-planning-input.jsonl` — compact candidate list for the UIKit planner, if present
- `generated/components/` — compact component evidence files (primary LLM input)
- `generatedFiles` — list of all bundle-generated files (JSONL)
- `warnings` — any data integrity issues

**JSONL Reading**: The manifest is in JSONL format. Read the full file — line 0 is meta (content overview), subsequent lines have `_type` field (`stats`, `shortlist`, `navigation`, `generatedFile`). Parse each line as a separate JSON object.

**After reading manifest, Main Agent has**:
- Component shortlist (all valid categories) — directly from `manifest.shortlist`
- Evidence availability — `manifest.generatedFiles` contains `generated/components/index.jsonl`
- UIKit planning input availability — `manifest.generatedFiles` contains `generated/uikit-planning-input.jsonl`
- Valid file manifest — directly from `manifest.validFiles` + `manifest.componentFilesBySlug`
- Bundle stats — directly from `manifest.stats`
- Generated file list — for Phase 2b copy operations

**Do NOT** deep-read token values, component structures, or annotation text.

### § 1.1 — Template Pre-Read Pipeline (MANDATORY)

At the END of Phase 1 (same LLM call as manifest Read or Phase 1→2 TodoWrite), parallel-read ALL dispatch templates:

| Template | Used In |
|----------|---------|
| `examples/templates/phase-2-analysts.md` | Phase 2 dispatch |
| `examples/templates/figma-token-gen.md` | Phase 2b token generation |

**Execution**: Include these 2 Read calls in the SAME tool call batch as the Phase 1→2 TodoWrite.

**After this step**: Main Agent has Phase 2 templates cached in context. Do NOT pre-read Phase 3/4 templates here: `examples/templates/phase-2.5-intent-synthesis.md` is read by Main Agent at Phase 3 entry (§ 3.1, budgeted in SKILL.md Read Budgets); `examples/templates/phase-4-ui-kit.md` is read by the UIKit sub-agent only. Read `examples/templates/phase-3-4-component.md` only if Phase 3 Evidence/Legacy fallback is actually triggered.

### § 1.2 — Shortlist Recovery (CONDITIONAL — when component split is needed)

When BundleGenerator produced a shortlist that is too coarse (typically because all components are on a single Figma Page or the page naming is non-semantic), Main Agent MUST recover by analyzing the component JSON and splitting it.

**Trigger conditions** (any of these → trigger recovery):
- `manifest.splitHint?.needed === true` (preferred — parser pre-computed)
- `shortlist` is empty array AND `componentFilesBySlug` has exactly 1 entry
- `shortlist.length <= 1` AND `stats.totalPrimitives > 6`
- `stats.componentCategories <= 2` AND `stats.totalPrimitives > 6`
- The single category slug matches internal/canvas/deprecated patterns

**Recovery procedure**:

1. Read the component evidence JSON: `{bundle_path}/generated/components/{slug}.jsonl` — use the single slug from `shortlist[0].slug` (allowed as an extra Read outside normal budget — see SKILL.md Read Budget exception)
2. Analyze `variantAxes` keys and `coverageMatrix.byAxis` to identify distinct component types:
   - Group by the FIRST variant dimension axis value that appears semantic (e.g., `Type=TextOnly` → "Button", `Select=True` → "Tab")
   - Alternative: group by `representativeVariants[].name` prefix before first comma only when coverageMatrix is absent
3. Dispatch a **component-splitter sub-agent** (Task, `subagent_type: "general_purpose_task"`):

```
Task: Split monolithic component JSON into logical component groups.
Input:
  - Read: {bundle_path}/generated/components/{slug}.jsonl (the single large file)
  - Stats: totalPrimitives={N}, totalVariants={M}
  - variantDimensions keys: {keys from manifest or JSON header}
Rules:
  - Analyze structures[].name patterns to identify distinct component categories
  - Each category must have a clear semantic identity (Button, Tab, Input, Badge, Checkbox, Toggle, etc.)
  - If manifest already contains component usage hints, use them as priority anchors. Do NOT read design-tokens.jsonl for recovery.
  - Group structures by their primary Type/variant axis; merge minor groups (<3 variants) into nearest neighbor
  - For each category, produce a JSON with: slug, name, nameEn, variantCount, primitiveCount, variantDimensions (subset), structurePatterns (subset), childComponents (subset), structures (subset)
  - If split is stable: Write individual files to {tmp_dir}/split-components/{new-slug}.json and index to {tmp_dir}/split-components/index.json
  - If split is NOT stable: write nothing and return recoveryFailed=true with reason
  - Do NOT delete or mutate any {output_dir}/components files during Phase 1 recovery
    - ReturnReportFileAbs: `{tmp_dir}/agent-reports/phase1-shortlist-recovery.json`
    - Completion: write { "shortlist": [{ "slug": "...", "name": "...", "variantCount": N }], "splitComponentDir": "{tmp_dir}/split-components", "recoveryFailed": false, "writtenFiles": [...], "warnings": [] } to ReturnReportFileAbs, then final-respond only "已完成组件识别。"
  - Forbidden tools (per SKILL.md invariant #16): TodoWrite, Skill, Grep, RunCommand, SearchCodebase; this task additionally forbids LS, Glob
```

4. If recovery returns `recoveryFailed: true` or an empty shortlist, Main Agent downgrades to the original single component JSON and proceeds without splitting. Do NOT block generation.
5. If recovery succeeds, Main Agent uses the returned `shortlist` as if it came from the manifest and records `splitComponentDir` for Phase 2 copy.
6. Phase 2b component copy uses `{tmp_dir}/split-components` when `splitComponentDir` exists; otherwise it uses bundle `generated/components`.

**Read Budget exception**: This recovery path is allowed 1 additional Read (the monolithic JSON header, limit: 250 lines) plus 1 Task dispatch. These do NOT count toward the 8-read cap.

**Timing**: § 1.2 executes BEFORE § 1.1 template pre-read. If recovery is triggered, template pre-read happens AFTER the splitter sub-agent returns (same message as the Phase 1→2 TodoWrite).

---

## Phase 2 — Brand Analysis + Token Generation

> **User output**: silent by default. Do not announce Phase 2 dispatch unless verbose/debug mode is active.

Phase 2 has three sequential stages:
1. **Stage 1** (fast, single RunCommand): § 2.3b bundle structural file copy + token input gate (produces `TOKEN_GEN_MODE` on stdout and `{tmp_dir}/design-tokens.jsonl` on disk)
2. **Stage 2 — Parallel** (same assistant message, after § 2.3b returns): brand-analyst Task + § 2.4b token-gen Task (when `TOKEN_GEN_MODE=llm`). The two sub-agents share no data dependency: token-gen derives brand context by reading `{bundle_path}/generated/brand-input.jsonl` itself — it does NOT need the brand-analyst return.
3. **Stage 3** (after both Stage 2 Tasks return): § 2.4c deterministic script (css-to-json.mjs)

**Stage 1 — File copy (RunCommand):** see § 2.3b below. Check stdout for `TOKEN_GEN_MODE` before Stage 2.

**Stage 2 — Parallel dispatch (same tool batch):**

**Tool call 1**: Task — brand-analyst (see template binding below)
**Tool call 2**: Task — § 2.4b token-gen (only when `TOKEN_GEN_MODE=llm`; skip when `bundle`)

> ⚠️ **subagent_type**: ALL Task calls MUST use `subagent_type: "general_purpose_task"`. Never use "Explore" or "search" — sub-agents must have Write capability.

**Template binding (SSOT)**: For the brand-analyst Task, copy the matching template from `examples/templates/phase-2-analysts.md`, fill the actual bundle path and Phase 1 shortlist/manifest. The template is the source of truth for inline reading strategy, constraint reads, read budgets, and output file list. If any summary below conflicts with the template, the template wins.

### brand-analyst

```
Task: Analyze brand identity, product type, and visual personality.
Output: BrandProfile JSON
Constraint strategy:
  - Use the inline reading strategy from examples/templates/phase-2-analysts.md
  - Do NOT add extra constraint-file reads unless the template's inline strategy is absent
Input data:
  - Bundle root path: {bundle_path}
  - Tmp dir: {tmp_dir}
  - Brand input file (PRIMARY): {bundle_path}/generated/brand-input.jsonl
  - Valid files (supplementary): {validFiles.context}
  - Supplementary files (if brand-input.jsonl insufficient):
    generated/annotations-summary.jsonl, context/brand-clues.md, annotations/ui-copies*.md
Report file format (`ReturnReportFileAbs: {tmp_dir}/agent-reports/phase2-brand-analyst.json`):
  - writtenFiles: ["{tmp_dir}/phase2-brand-analyst.json"]
  - summary: "Product: {type} ({confidence}). Personality: ... Language: ... Kit: ... Prefix: ... Warnings: ..."
  - warnings: string[]
```

**Sub-agent Return Contract (Phase 2)**:

Each analyst sub-agent MUST:
1. Write its analysis JSON to disk: `{tmp_dir}/phase2-{analyst-name}.json`
2. Write a structured orchestration report to `ReturnReportFileAbs` (≤ 4KB):
   - `writtenFiles: ["{tmp_dir}/phase2-{analyst-name}.json"]`
   - `summary`: A compact text summary (key findings, counts, warnings)
   - `warnings: string[]`
   - **Orchestration fields** (analyst-specific, see below)
3. Final response: `已完成设计规范分析。`

**brand-analyst orchestration fields:**
- `language`: `string` — UI language (e.g., "zh-CN", "en")
- `kitType`: `string` — one of: app | website | poster | dashboard
- `productType`: `string` — product domain
- `personality`: `string[]` — brand personality traits
- `uiCopySamples`: `string[]` — ≤5 representative UI copy samples
- `colorNamingPrefix`: `string` — brand-derived naming prefix for CSS variables (e.g., "atlas", "zen")

**After brand-analyst AND token-gen both return** (next assistant message — both Stage 2 Tasks have returned):
1. Extract orchestration fields from brand-analyst return (language, kitType, productType, personality, uiCopySamples, colorNamingPrefix)
2. Run § 2.4c deterministic script (css-to-json.mjs) against the final CSS
3. After § 2.4c completes: Dispatch Phase 3 Batch 1 (first up to 3 component sub-agents)

> **Why Stage 1 runs first?** § 2.3b file copy must complete before Stage 2 because the token-gen sub-agent reads `{tmp_dir}/design-tokens.jsonl` (placed by the copy) and `TOKEN_GEN_MODE` decides whether token-gen is dispatched at all.
>
> **Why Stage 2 is parallel?** Brand-analyst reads `generated/brand-input.jsonl`; token-gen reads `{tmp_dir}/design-tokens.jsonl` + `generated/brand-input.jsonl` (it derives brand context from raw data itself, per `figma-token-gen.md` READ SEQUENCE). They share no output dependency. Dispatching both in the same tool batch saves one full LLM roundtrip (~15-20s+, token-gen is the long-tail task).
>
> **Why Phase 3 waits for § 2.4c?** Phase 3 sub-agents depend on `colors_and_type.css` and `css.json` reflecting the FINAL token set (from LLM-generated CSS). § 2.4c derives `css.json` from scratch — there is no bundle-generated version to overwrite.

### § 2.4 Post-Analysis Orchestration (Main Agent)

> **User output**: silent by default. Do not print analysis summaries, counts, file paths, or return/report JSON.

After the Phase 2 brand-analyst returns, Main Agent assembles orchestration data **from `{tmp_dir}/agent-reports/phase2-brand-analyst.json` only** (zero reads of generated CSS/HTML/MD artifacts):

1. **Extract** from structured report:
   - `language` / `kitType` / `productType` / `personality` / `uiCopySamples` ← brand-analyst return
   - `outputPlan` ← already computed in Phase 1 (shortlist → previewPages 1:1 mapping)

2. **Assemble Phase 3 dispatch parameters** (store for immediate use):
   - `availableIcons[]` — from Phase 1 bundleManifest (icon filenames without .svg extension)
   - `outputPlan` — component slugs for dispatch
   - `language` / `kitType` / `productType` / `uiCopySamples` — for all sub-agents

3. **Record icon availability from § 2.3b copy results**:
   - If `{output_dir}/assets/icons/` was populated by § 2.3b RunCommand, record the copied SVG filenames as `availableIcons[]` (without `.svg` suffix) and set `assetWrittenFiles[]` for inclusion in the cumulative `writtenFiles`.
   - If no SVGs were copied (bundle had no `assets/icons/*.svg` files), sub-agents will use `<symbol>` fallback pattern instead.
   - **Do NOT re-execute icon copy here** — it is already handled by § 2.3b RunCommand.

### § 2.3b Bundle File Copy (RunCommand — dispatched in parallel with brand-analyst)

Main Agent copies structural files and LLM input data from the bundle. `design-tokens.jsonl` is a minified LLM contract and is copied to `{tmp_dir}` only; token outputs (`colors_and_type.css`, `css.json`) are generated from CSS.

**To `{tmp_dir}` (LLM input for § 2.4b):**
- `{bundle_path}/generated/design-tokens.jsonl` → `{tmp_dir}/design-tokens.jsonl`
- `{bundle_path}/generated/uikit-planning-input.jsonl` → `{tmp_dir}/uikit-planning-input.jsonl` when present

**To `{output_dir}` (final deliverables — structural only):**
- **(Components — Skip if Token-Only or `components` in skipSet)**:
  - If Phase 1 recovery produced `{tmp_dir}/split-components`: read `index.{jsonl,json}` and `{slug}.{jsonl,json}` from that directory, then normalize to `{output_dir}/components/_evidence/*.json`
  - Otherwise read `{bundle_path}/generated/components/index.{jsonl,json}` → write `{output_dir}/components/_evidence/index.json`
  - Otherwise read `{bundle_path}/generated/components/{slug}.{jsonl,json}` × N → write `{output_dir}/components/_evidence/{slug}.json`
    (list from `manifest.generatedFiles` filtered by `generated/components/` prefix, excluding subdirectories)
  - The script performs deterministic JSONL/JSON → JSON normalization at the copy boundary. Do not preserve `.jsonl` under `components/_evidence/`.
- **(Visual previews — optional global hints)**:
  - Copy `{bundle_path}/assets/previews/*` → `{output_dir}/assets/previews/*` when present
  - Copy `{bundle_path}/context/visual-preview.md` → `{output_dir}/context/visual-preview.md` when present

**Bundle file copy (2 commands in sequence)**:
```bash
# Step 1: Structural file copy via script (components + icons)
node "{SKILL_DIR}/scripts/copy-bundle-assets.mjs" \
  --bundle "{bundle_path}" \
  --output "{output_dir}" \
  --tmp "{tmp_dir}" \
  --manifest "{bundle_path}/generated/bundle-manifest.jsonl" \
  --split-components "{tmp_dir}/split-components"

# Step 2: Token source detection + quality gate (determines § 2.4b path)
TOKEN_FILE=""
if [ -f "{bundle_path}/generated/design-tokens.jsonl" ]; then
  TOKEN_FILE="{bundle_path}/generated/design-tokens.jsonl"
elif [ -f "{bundle_path}/generated/design-tokens.json" ]; then
  TOKEN_FILE="{bundle_path}/generated/design-tokens.json"
fi

if [ -n "$TOKEN_FILE" ]; then
  TOKEN_EXT="${TOKEN_FILE##*.}"
  cp "$TOKEN_FILE" "{tmp_dir}/design-tokens.$TOKEN_EXT"
  token_gate=$(node "{SKILL_DIR}/scripts/validate-token-input.mjs" "{tmp_dir}/design-tokens.$TOKEN_EXT" --legacy-css "{bundle_path}/generated/colors_and_type.css" --json)
  echo "$token_gate"
  token_mode=$(printf '%s' "$token_gate" | node -e 'const fs=require("fs"); const input=fs.readFileSync(0,"utf8"); console.log(JSON.parse(input).mode)')
  if [ "$token_mode" = "llm" ]; then
    echo "TOKEN_GEN_MODE=llm"
  elif [ "$token_mode" = "bundle" ]; then
    cp "{bundle_path}/generated/colors_and_type.css" "{output_dir}/colors_and_type.css"
    echo "TOKEN_GEN_MODE=bundle"
  else
    echo "TOKEN_GATE_FAILED: design-tokens file is unreadable or uses an unsupported old schema"
    exit 1
  fi
else
  cp "{bundle_path}/generated/colors_and_type.css" "{output_dir}/colors_and_type.css"
  echo "TOKEN_GEN_MODE=bundle"
fi
```

**After RunCommand returns**: Check stdout for `TOKEN_GEN_MODE`. If `llm` → proceed to § 2.4b, then § 2.4c. If `bundle` → skip § 2.4b only, then still run § 2.4c against the copied CSS.

> Purpose: § 2.4b token-gen sub-agent reads `{tmp_dir}/design-tokens.jsonl` (full read or chunked if > 64KB). § 2.4c generates `css.json` from the final CSS (LLM-generated or legacy bundle CSS). Phase 3/4 sub-agents read `colors_and_type.css` directly for CSS variable names, not `design-tokens.jsonl`.

### § 2.4b Token CSS Generation (LLM — dispatched in PARALLEL with brand-analyst in Stage 2, CONDITIONAL on TOKEN_GEN_MODE=llm)

**Unified path — aligned with from-scratch / refine-library: CSS is the source, css.json is derived.**

> Skip this section entirely if § 2.3b output `TOKEN_GEN_MODE=bundle` (legacy fallback).

Dispatch a token-gen sub-agent (Task, `subagent_type: "general_purpose_task"`) in the SAME tool batch as the brand-analyst Task (Phase 2 Stage 2).

**Template binding**: Use `examples/templates/figma-token-gen.md` — fill actual paths. Brand context is self-derived by the sub-agent from `brand-input.jsonl` (see the template's Brand context section); do NOT wait for brand-analyst orchestration fields.

**Input files (sub-agent reads from disk):**
1. `{tmp_dir}/design-tokens.jsonl` — minified core data (colors/fonts/spacing/radius/structured shadows + specAnnotations designer token annotations); sub-agent uses chunked reads if > 64KB
2. `{bundle_path}/generated/brand-input.jsonl` — brand analysis
3. `{bundle_path}/generated/annotations-summary.jsonl` — compact designer annotations and UI copy summary
4. `{bundle_path}/annotations/index.md` — designer prose fallback
5. `{SKILL_DIR}/file-specs/css-tokens.md` — CSS format spec

**Output**: `{output_dir}/colors_and_type.css`

**Sub-agent report contract (`ReturnReportFileAbs: {tmp_dir}/agent-reports/phase2-token-gen.json`):**
- `writtenFiles: ["{output_dir}/colors_and_type.css"]`
- `tokenCount`: N (total CSS custom properties)
- `flatTokenSummary`: compact summary
- `sourceStats`: `{ fromVariables: N, fromVisualAnnotations: M, interpolated: K }`
- `warnings`: string[]

### § 2.4c Deterministic Token Derivation (RunCommand — MANDATORY after token CSS exists)

> Do NOT skip this section for `TOKEN_GEN_MODE=bundle`. Bundle mode skips only the LLM token-gen task; deterministic derivation still owns `css.json`.

> ⚠️ **ALWAYS execute this step** regardless of what the § 2.4b sub-agent returns.
> The sub-agent's `validated` field is about CSS structural validity only —
> it does NOT mean css.json was generated.
> These scripts are YOUR (Main Agent's) responsibility. Never trust sub-agent
> to have run them. Even if they appear to exist, re-run unconditionally.

Run 1 deterministic script (0 LLM cost) after `{output_dir}/colors_and_type.css` exists:

```bash
node "{SKILL_DIR}/scripts/css-to-json.mjs" "{output_dir}/colors_and_type.css" --output "{output_dir}/css.json"
```

**Post-condition check** (non-blocking): After running, verify output files exist:
- `{output_dir}/css.json` — MUST contain shadow, radius, spacing, color, font, size sections


### § 2.5 Pre-Generation Checkpoint (BLOCKING)

Before proceeding to Phase 3 (i.e., in the assistant message AFTER all Phase 2 stages complete), Main Agent MUST verify:
- [ ] Brand analyst JSON exists: `{tmp_dir}/phase2-brand-analyst.json`
- [ ] Token CSS generated: `{output_dir}/colors_and_type.css` (via § 2.4b LLM or legacy bundle copy)
- [ ] css.json derived: `{output_dir}/css.json` (via § 2.4c script or legacy bundle copy)
- [ ] (Skip if tokenOnly) `components/_evidence/index.json`, `components/_evidence/{slug}.json` × N when bundle evidence exists; if missing, record low-fidelity warning
- [ ] Do NOT require `components/index.json` or `components/{slug}.json` here. They are Phase 3 outputs.
- [ ] Main Agent context contains ONLY orchestration data from reports — no raw JSON content; Phase 3/4 do not read `{tmp_dir}/design-tokens.jsonl`

⚠️ If you catch yourself about to Write a .css/.html/.md file: STOP → reroute to Task dispatch.

### § 2.6 Adaptive Branch (Token-Only / skipSet)

Before Phase 3, compute `generatedArtifacts` from known writes/copies and `skipSet`.

If `components` in `skipSet` OR Token-Only Bundle:
- Skip Phase 3 entirely.
- Do NOT require `components/index.json`, `components/{slug}.json`, or `preview/component-*.html`.
- Proceed directly to Phase 4 docs dispatch with `generatedArtifacts`, `skipSet`, and `CSSFile`.

If `previews` in `skipSet`:
- Keep copied/generated component JSON files.
- Skip Phase 3 preview dispatch and preview gates.
- Do NOT include preview files in `generatedArtifacts`.

If `uikit` in `skipSet` OR Token-Only Bundle:
- Phase 4 dispatches docs only (SKILL.md + README.md).
- Do NOT read or dispatch the UI Kit template.

### § 2.7 Deterministic UIKit Plan Gate

> ⚠️ **HARD PREREQUISITE**: Before running `generate-uikit-plan.mjs`, VERIFY that `{output_dir}/components/_evidence/index.json` exists.
> If it does NOT exist, you MUST first run `copy-bundle-assets.mjs` (§ 2.3b).
> Do NOT proceed without this file — the planner will fail with `PREREQUISITE_MISSING`.

Run this section after § 2.5/§ 2.6 passes and before Phase 3, unless `components` in `skipSet`, Token-Only Bundle, or both `previews` and `uikit` are skipped.

Do not dispatch a planning Task. Do not read `{output_dir}/components/_evidence/{slug}.json` during planning. Do not assemble `uikit-plan.json` in the Main Agent response.

Deterministic generator gate:

```bash
node {SKILL_DIR}/scripts/generate-uikit-plan.mjs \
  --planning-input {tmp_dir}/uikit-planning-input.jsonl \
  --evidence-index {output_dir}/components/_evidence/index.json \
  --brand-data {tmp_dir}/phase2-brand-analyst.json \
  --available-vars {output_dir}/colors_and_type.css \
  --out {tmp_dir}/uikit-plan.json \
  --out {output_dir}/uikit-plan.json
```

> NOTE: do NOT pass `--components-css` here — `components.css` is generated later in § 3.6.
> Sidebar layout hints are injected by the § 3.6b `--patch-layout` step after Phase 3 completes.

Validator gate:

```bash
node {SKILL_DIR}/scripts/validate-uikit-plan.mjs \
  --plan {tmp_dir}/uikit-plan.json \
  --evidence-index {output_dir}/components/_evidence/index.json \
  --out {tmp_dir}/uikit-plan.json \
  --out {output_dir}/uikit-plan.json
```

`generate-uikit-plan.mjs` and `validate-uikit-plan.mjs` are the only allowed writers for the final normalized `uikit-plan.json` copies. The validator accepts the standard schema and minor field aliases (`evidence` -> `evidenceFile`, `components` -> `componentSlugs`), but it MUST fail on intermediate schemas such as top-level `strategy`, `families`, `decisions`, or `coverageSummary`.

`uikit-plan.json` schema:

```json
{
  "schemaVersion": 1,
  "corePreviewComponents": [
    { "slug": "button", "reason": "...", "evidenceFile": "components/_evidence/button.json", "priority": 1 }
  ],
  "supportEvidenceComponents": [
    { "slug": "tag", "reason": "...", "evidenceFile": "components/_evidence/tag.json" }
  ],
  "allowedComponents": ["button", "tag"],
  "screenBlueprints": [
    { "name": "Overview", "purpose": "...", "componentSlugs": ["button"], "layoutIntent": "..." }
  ],
  "forbiddenInventedComponents": [],
  "needsNarrative": false,
  "lowConfidence": false,
  "warnings": []
}
```

**Product narrative for design-system files**: when the Figma file is a pure design system (token specimen page names, placeholder copy), the generator sets `needsNarrative: true` and leaves `screenBlueprints[*].name` null. The generator consumes `productNarrative` from `{tmp_dir}/phase2-brand-analyst.json` (written by the Phase 2 brand-analyst per its template) to fill scenario-based screen names/purposes/primaryActions via `--brand-data`. If `needsNarrative` remains true with null screen names after generation, the Phase 4b UIKit sub-agent must design its own realistic product scenarios — token specimen page names are FORBIDDEN as view names.

Fallback:
- If `{tmp_dir}/uikit-planning-input.jsonl` or `components/_evidence/index.json` is missing, skip deterministic plan and derive Phase 3 preview list from `manifest.shortlist`.
- If evidence index exists and `generate-uikit-plan.mjs` fails, STOP before Phase 3. Do not fallback to full component JSON and do not ask LLM to repair.
- If evidence index exists but `validate-uikit-plan.mjs` fails because the generated plan is missing, malformed, non-standard, uses an intermediate schema, or contains an empty `allowedComponents` array, STOP before Phase 3. Do not fallback to full `components/{slug}.json` for normal generation.
- The fallback path uses `components/{slug}.json` directly only when evidence index/files are absent.
- When deterministic plan succeeds, `{output_dir}/uikit-plan.json` is part of the final Library contract and must be preserved for downstream `solo-design`.

### § 2.9 Anti-Violation Barrier (BLOCKING — checked before EVERY Phase 3+ dispatch)

Main Agent MUST pass ALL assertions:
- [ ] No nested JSON objects > 10 keys assembled in Main Agent response
- [ ] No hex color arrays in context (color data lives in bundle-generated files on disk)

**If any assertion fails**: STOP. Identify the violation. Discard the violating data. Resume from the last valid state.

**Violation indicators** (if you observe these in your own output, you ARE in violation):
- Your response lists 3+ `#xxxxxx` values → You are computing colors inline → STOP
- You have > 20 bundle/intermediate Read calls (scope per SKILL.md § Hard stops) → You read sub-agent scope files → STOP
- Your context feels "heavy" and responses are slowing down → Context distillation was skipped → Perform § 3.5 distillation NOW

---

## Phase 3 — Component Synthesis (Intent + Preview merged)

> **User output**: "Generating {N} component previews..." (see `user-output-policy.md` § Output Templates, Phase 3a — never expose internal terms like "intent")

**CRITICAL**: Every component MUST be generated by a Task sub-agent. Main Agent MUST NOT Write any JSON/HTML directly, except `components/index.json` via the deterministic aggregation script.

### § 3.0 Scope Gate (HARD)

**Pre-condition**: `colors_and_type.css` + `css.json` exist; `_evidence/` files present.
**Skip condition**: Token-Only Bundle OR `components` in `skipSet` OR `_evidence/` absent.

⚠️ SYNTHESIS SCOPE GATE:
- Component list = ONLY `uikit-plan.corePreviewComponents` slugs.
- `supportEvidenceComponents` do NOT receive synthesis. UIKit consumes raw `_evidence`.
- FORBIDDEN: iterating `_evidence/` to generate for ALL components.
- FORBIDDEN: generating intent JSON for support-only components.

**Deterministic slug extraction (MANDATORY — execute before dispatching ANY component synthesis sub-agent)**:

```bash
node -e "const p=JSON.parse(require('fs').readFileSync('{tmp_dir}/uikit-plan.json','utf8'));const s=(p.corePreviewComponents||[]).map(c=>c.slug);console.log(JSON.stringify({slugs:s,count:s.length}));"
```

- Use `slugs` from stdout as the ONLY dispatch list.
- Use `count` as the sub-agent dispatch upper bound.
- If count is 0, STOP; the UIKit plan has no core components.

**First-batch cap (Figma import path only)**:
- If a legacy/fallback plan reports `count > 6`, only the **first 6** slugs enter Phase 3 synthesis in this run.
- Do NOT trim `components/_evidence/*`, `components/_evidence/index.json`, `uikit-planning-input`, or `supportEvidenceComponents`; they remain available to UIKit and future `expand-components` runs.
- Treat remaining evidence-backed slugs as deferred components for future `expand-components` runs upon user request. Phase 3 caps only the intent/preview dispatch list.

### § 3.1 Dispatch Intent + Preview Tasks (Batches of 3)

**Template**: Read `examples/templates/phase-2.5-intent-synthesis.md` at Phase 3 entry (1 Read, budgeted in SKILL.md Read Budgets) and reuse it for all component dispatches in this run.

⚠️ **FULL QUERY DISPATCH (NON-NEGOTIABLE)**:
Main Agent MUST extract the fenced Task Query Template body from `examples/templates/phase-2.5-intent-synthesis.md`, replace `{Name}`, `{slug}`, `{output_dir}`, and `{SKILL_DIR}`, then pass that expanded Task Query Template body as the Task query.

Do NOT dispatch a task that says "read the template and execute it". Indirect template-reading dispatch makes the sub-agent re-read templates, discover directories, and ignore tool restrictions, which causes costly retries.

- Each component gets its own dedicated Task (1 component = 1 Task). NEVER combine multiple components into one Task query.
- Dispatch up to 3 Tasks in parallel per assistant turn.
- Continue turn-by-turn until all **first-batch** slugs (max 6) have been dispatched.
- Example: 6 components → Turn 1: Task(button) + Task(navigation) + Task(menu), Turn 2: Task(card) + Task(tag) + Task(table).

**Each sub-agent produces TWO files**:
1. `{output_dir}/components/{slug}.json` — LLM-generated intent JSON
2. `{output_dir}/preview/component-{slug}.html` — Preview HTML

Component contract outputs:
- `components/{slug}.json` from merged Phase 3 synthesis has `ComponentContractKind: intent-json`.
- `components/_evidence/{slug}.json` remains the fallback contract with `ComponentContractKind: evidence` when a synthesized intent/preview is intentionally skipped or missing.

Fill per component:

```
Task: Generate component "{Name}" (slug: {slug}) — intent + preview.
[Use expanded Task Query Template body verbatim with paths filled]
```

⚠️ DISPATCH SELF-CHECK (Main Agent — before sending each component Task):
□ Does the Task query contain "Forbidden tools"? If NO → you did not expand the template body.
□ Does it contain "WebSearch" and "WebFetch"? If NO → external search is not banned.
□ Does it contain "renderFacts"? If NO → Render Contract v2 SSOT rules are missing.
□ Does it contain the resolved `{output_dir}/components/_evidence/{slug}.json` path? If NO → the per-slug evidence path was not filled.
□ Does it contain the resolved `{output_dir}/components/{slug}.json` path? If NO → intent output path is missing.
□ Does it contain "STOP immediately after writing"? If NO → sub-agent may verify/read back.
If any check fails, STOP before Phase 3 dispatch and re-read `examples/templates/phase-2.5-intent-synthesis.md`.

### § 3.2 Validation Gate (after ALL return)

**Intent validation (advisory by default; do not retry solely for schema warnings)**:

```bash
node {SKILL_DIR}/scripts/validate-intent.mjs --intent-dir {output_dir}/components --vars-file {output_dir}/colors_and_type.css
```

**Preview existence check**:

```bash
node {SKILL_DIR}/scripts/check-design-library-phase.mjs {output_dir} --phase preview --files preview/component-{slug1}.html,preview/component-{slug2}.html,...
```

**No retry/fallback loop**:
- Do not retry component tasks because of advisory intent validation, preview evidence fidelity warnings, sample count, radius/shadow/style mismatch, or other quality concerns.
- Do not dispatch `phase-3-4-component.md` automatically from create-library. It is reserved for explicit manual repair requests.
- If the preview validator reports an objective runtime blocker (missing file, broken stylesheet link, invalid JSON parse, undefined CSS variable), retry only the affected component slug(s), at most once per slug. Derive affected slugs from validator file paths such as `preview/component-{slug}.html` or `components/{slug}.json`. Never retry or regenerate unaffected components in the same batch. If a targeted retry still fails, stop with the compact validator output. Do not synthesize a fallback component in the Main Agent.
- Undefined CSS variables are a targeted component repair only. The repair prompt must say: read `colors_and_type.css`, replace invented/local variables with declared variables from that file, remove any preview-local CSS custom property declarations, and do not touch other component files.
- UIKit may read `_evidence/{slug}.json` as low-fidelity fallback only when a component was intentionally skipped or absent from generated previews; record `rendered-from-evidence:{slug}`.

### § 3.3 Index Aggregation (Main Agent)

```bash
node -e "const fs=require('fs'),p=require('path'),d='{output_dir}/components';const f=fs.readdirSync(d).filter(x=>x.endsWith('.json')&&x!=='index.json'&&!x.startsWith('_'));const components=f.map(x=>{const j=JSON.parse(fs.readFileSync(p.join(d,x),'utf8'));return{slug:j.slug,name:j.name,category:j.category,sourceKind:'figma-intent'}});fs.writeFileSync(p.join(d,'index.json'),JSON.stringify({schemaVersion:1,components},null,2));console.log('index.json:',components.length,'components');"
```

This script is the SOLE writer of `components/index.json`. Sub-agents MUST NOT touch this file.

### § 3.4 Phase 3 Completion Sentinel (BLOCKING)

Before any Phase 4 template reads or dispatch:
- Skip this sentinel entirely when `components` in `skipSet`, `previews` in `skipSet`, or Token-Only Bundle. In those cases, Phase 4 docs consume `CSSFile` directly.
- Every core preview component slug from `uikit-plan.corePreviewComponents` has one generated `components/{slug}.json` or recorded `_evidence` fallback.
- Every core preview component slug from `uikit-plan.corePreviewComponents` has exactly one `preview/component-{slug}.html` return, unless that component was intentionally skipped and `rendered-from-evidence:{slug}` is recorded for UIKit.
- No support-only component has a generated `components/{slug}.json` intent unless it was also in `corePreviewComponents`.
- No component sub-agent report is missing required intent/preview outputs.
- Token files exist on disk: `{output_dir}/colors_and_type.css`, `{output_dir}/css.json`.
- Phase 3 gates from §3.2 have been run.

If preview HTML or intent JSON is physically missing, stop and report the missing slug(s). Do not dispatch replacement tasks from the Main Agent. Advisory intent validation warnings must not block Phase 4.

### § 3.5 Context Distillation (MANDATORY before Phase 4)

After processing all Phase 3 reports:

**Retain for Phase 4** (compact data, pass via file paths):
- cumulative `writtenFiles` list (paths only)
- `BundleWarnings[]` from Phase 2
- `output_dir` path
- `language` + `kitType` + `productType` (3 strings)
- Intermediate file paths (for UIKit/doc sub-agents to Read from disk)

**Discard (do NOT reference again in any form)**:
- Phase 2 analyst summary text (already extracted into orchestration vars)
- Phase 3 sub-agent verbose stats/warnings (writtenFiles paths already collected from `{tmp_dir}/agent-reports/*.json`)

**Implementation**: Phase 4 Task queries pass ONLY file paths. Documentation sub-agents may read intermediate summaries; UIKit reads completed docs, preview HTML first, and `_evidence` only as fallback when preview is insufficient. Do NOT paste variable lists or component bodies in the Task query.

The SKILL.md documentation sub-agent also writes `{output_dir}/library-consumption.json` with the downstream read order:

```json
{
  "schemaVersion": 1,
  "tokenSource": "css.json",
  "componentEvidenceIndex": "components/_evidence/index.json",
  "uikitPlan": "uikit-plan.json",
  "recommendedReadOrder": ["SKILL.md", "css.json", "components/_evidence/index.json", "components/_evidence/{slug}.json", "uikit-plan.json", "components.css", "ui_kits/{type}/index.html"],
  "coreComponents": ["button"],
  "supportComponents": ["tag"]
}
```

### § 3.6 Component CSS Extraction (Main Agent, deterministic)

After ALL Phase 3 synthesis sub-agent reports have been read and § 3.3 index aggregation is complete:

```bash
node {SKILL_DIR}/scripts/extract-components-css.mjs {output_dir}
```

This script:
1. Reads `preview/component-*.html` files
2. Extracts CSS between `/* @component-css-start */` and `/* @component-css-end */` markers (falls back to heuristic extraction if markers missing)
3. Extracts representative DOM anatomy from `<body>` as `/* @anatomy */` comments
4. Validates `var(--name)` references against `colors_and_type.css`
5. Writes `{output_dir}/components.css`

**Success criteria**: stdout JSON has `ok: true` and `extractedCount >= 1`.

**If fails**: Check warnings. If any preview HTML lacks the CSS markers, this is a non-blocking warning (fallback extraction is used). Only fail if `extractedCount === 0`.

**Output file `components.css`** becomes a MANDATORY input for Phase 4a (docs) and Phase 4b (UIKit). It is the SOLE source of component CSS for UIKit — preview HTML is no longer read for CSS extraction.

### § 3.6b UIKit Plan Layout Patch (Main Agent, deterministic)

After § 3.6 succeeds AND `uikit-plan.json` exists (skip if `uikit` in skipSet or Token-Only Bundle):

```bash
node {SKILL_DIR}/scripts/generate-uikit-plan.mjs \
  --patch-layout \
  --components-css {output_dir}/components.css \
  --out {tmp_dir}/uikit-plan.json \
  --out {output_dir}/uikit-plan.json
```

This back-fills `layout.sidebarColumnWidth` (extracted from `.sidebar-shell` width in `components.css`) into the existing plan so the Phase 4b UIKit template can set `--uikit-sidebar-w`. A warning `patch-layout: no sidebar width found` is non-blocking — the UIKit CSS fallback `220px` applies.

---

## Phase 4 — Documentation then Sample Page (Sequential Rounds)

> **Phase Guard (UIKit)**: if `uikit` in skipSet OR Token-Only Bundle → do NOT dispatch UIKit sub-agent. Generate docs only, then proceed to Phase 5.

> **User output**: silent by default. Do not announce Phase 4 dispatch unless verbose/debug mode is active.

**CRITICAL**: Every output file MUST be generated by a Task sub-agent.

### § 4.0a Phase 4a Pre-Read (Main Agent)

Read `examples/templates/phase-5-docs.md`.

⚠️ DO NOT read `file-specs/*.md`. Those paths are passed inside Task queries — sub-agents read them themselves. Main Agent's job is to fill template placeholders with actual paths and dispatch.

### 4a: Documentation (2 Sub-Agents — SKILL.md + README.md)

Dispatch with templates from `examples/templates/phase-5-docs.md` (§ "Phase 4B: SKILL.md" and § "Phase 4C: README.md" templates).

Pass `generatedArtifacts`, `skipSet`, intermediate file paths + `BundleWarnings` + `OutputFileList` + per-task `ReturnReportFileAbs`:
- SKILL.md docs: `{tmp_dir}/agent-reports/phase4-docs-skill.json`
- README.md docs: `{tmp_dir}/agent-reports/phase4-docs-readme.json`

The SKILL.md documentation sub-agent writes both `SKILL.md` and `library-consumption.json`. The README.md sub-agent writes only `README.md`.

Docs sub-agents use `BrandFile: {tmp_dir}/phase2-brand-analyst.json` + `CSSFile: {output_dir}/colors_and_type.css` as primary input.

Include this execution block in documentation Task prompts:

```
⚠️ EXECUTION CONSTRAINTS (docs):
- BANNED tools: TodoWrite, Skill, LS, Glob, SearchCodebase, RunCommand
- TOTAL BUDGET: ≤ 3 calls.
- SILENT: No intermediate reasoning.
```

### § 4a.1 Documentation Completion Sentinel (BLOCKING — before UIKit dispatch)

Before dispatching UIKit:
- Documentation reports include `SKILL.md`, `library-consumption.json`, and `README.md`.
- Docs gate passes deterministic file-existence checks only:
  `node {SKILL_DIR}/scripts/check-design-library-phase.mjs {output_dir} --phase docs --files SKILL.md,README.md`
- If docs gate fails: retry only the failed documentation task, at most 1 retry per file. Do NOT proceed to UIKit until docs pass.
- If UIKit is skipped, this sentinel is sufficient for entering Phase 5.

### 4b: UIKit Showcase (1 Sub-Agent — after docs)

> Main Agent MUST NOT read `examples/templates/phase-4-ui-kit.md`. The UIKit sub-agent reads it directly (TEMPLATE-READ DISPATCH below).

Before dispatching the UIKit sub-agent, the Main Agent MUST derive and protect output paths from `OutputDir`:

```
OutputDir = {output_dir}
OutputFileRel = [
  "ui_kits/{kitType}/index.html",
  "ui_kits/{kitType}/quality-report.json"
]
OutputFileAbs = [
  "{output_dir}/ui_kits/{kitType}/index.html",
  "{output_dir}/ui_kits/{kitType}/quality-report.json"
]
```

Main Agent responsibilities before Task dispatch:
- Create `{output_dir}/ui_kits/{kitType}/` deterministically, for example `fs.mkdirSync(path.join(outputDir, "ui_kits", kitType), { recursive: true })`.
- Fill `OutputDir`, `OutputFileRel`, and `OutputFileAbs` into the UIKit Task query.
- Treat `OutputDir` as the only write-root SSOT. Do NOT ask the sub-agent to infer physical write paths from its current working directory.
- Keep report `writtenFiles` relative (`OutputFileRel`) for orchestration contracts, but require physical writes to absolute `OutputFileAbs`.

⚠️ **TEMPLATE-READ DISPATCH (NON-NEGOTIABLE)**:
The sub-agent reads `examples/templates/phase-4-ui-kit.md` directly as its first step and gets fresh, complete instructions.
Do NOT paste or hand-expand the template content into the Task query. Do NOT summarize or paraphrase the template.

The UIKit sub-agent consumes the completed library:
- `SKILL.md`
- `README.md`
- `colors_and_type.css` (read directly; executable CSS variable allowlist and semantic token source)
- `colors_and_type.css` via exact HTML link `../../colors_and_type.css`
- `preview/component-{slug}.html`
- optional `components/{slug}.json` only for variants/states
- optional `uikit-plan.json` only for whitelist/blueprint
- optional `components/_evidence/{slug}.json` only when preview is missing or insufficient
- `aesthetics/*.md`
- writes the absolute `OutputFileAbs` paths under `{output_dir}/ui_kits/{kitType}/`

It must NOT read UIKit-specific middle artifacts such as `preview-css-extracted.json`, `phase2-brand-analyst.json`, or `available-variables.json`.

⚠️ DISPATCH SELF-CHECK (Main Agent — before sending Task):
□ Does the Task query contain the template path "phase-4-ui-kit.md"?
□ Does the Task query contain "Read ... as your complete instruction set"?
□ Does the Task query contain actual resolved values for {output_dir}, {SKILL_DIR}, and {tmp_dir}?
□ Does the Task query contain OutputDir and OutputFileAbs with actual resolved paths?
□ Is the Task query shorter than 1500 characters? (If longer, you are hand-expanding the template — STOP.)
If any check fails, STOP and fix the Task query before dispatching.

```
Task: Generate interactive Design System Showcase (type: {kitType from § 2.4}).

## Your first step
Read {SKILL_DIR}/examples/templates/phase-4-ui-kit.md — this is your complete instruction set. Follow every rule in it.

## Parameters
- {kitType} = [actual kit type]
- {output_dir} = [actual absolute output path]
- {SKILL_DIR} = [actual absolute skill path]
- {tmp_dir} = [actual absolute tmp path]

## Key Input Data (sub-agent reads full list from template)
- DesignSkillFile: {output_dir}/SKILL.md
- BrandNarrativeFile: {output_dir}/README.md
- CSSFile: {output_dir}/colors_and_type.css
- CSSLink: "../../colors_and_type.css"
- ComponentPreviewDir: {output_dir}/preview/
- OutputDir: {output_dir}/ui_kits/{kitType}
- OutputFileAbs: ["{output_dir}/ui_kits/{kitType}/index.html", "{output_dir}/ui_kits/{kitType}/quality-report.json"]
- ReturnReportFileAbs: "{tmp_dir}/agent-reports/phase4-uikit-{kitType}.json"

## Constraint
Tool bans per SKILL.md invariant #16 (TodoWrite, Skill, Grep, RunCommand, SearchCodebase), plus WebSearch, WebFetch. LS/Glob allowed only within the discovery paths the template scopes.
Read: UNLIMITED. Read ALL constraint files and data files for accuracy.

## Report file format
- writtenFiles: ["ui_kits/{type}/index.html", "ui_kits/{type}/quality-report.json"]
- stats: { screensGenerated: N, componentsUsed: N, previewClassReuseRate: N }
- warnings: string[]

Final response:
已完成 UI Kit。
```

### § 4b.1 UIKit Completion Sentinel (BLOCKING — before Phase 5)

Before Phase 5:
- If UI Kit was dispatched, UI Kit report includes `ui_kits/{type}/index.html` and `ui_kits/{type}/quality-report.json`.
- Do not trust the sub-agent's reported `writtenFiles` as proof of physical output. The Main Agent MUST check `path.join(OutputDir, OutputFileRel)` / `OutputFileAbs` on disk.
- If UI Kit was dispatched, UIKit gate passes deterministic checks only:
  `node {SKILL_DIR}/scripts/check-design-library-phase.mjs {output_dir} --phase uikit --files ui_kits/{type}/index.html --uikit-plan {output_dir}/uikit-plan.json`
- Use `--require-uikit-plan` for final validation only when `components/_evidence/index.json` exists and UI Kit generation was not skipped:
  `node {SKILL_DIR}/scripts/validate-design-library-output.mjs {output_dir} --require-uikit-plan`
- Token-only, no-evidence, from-scratch, structured-spec, and legacy routes keep the normal validator command.

Deterministic gates check file presence, standard CSS links, CSS variable definitions, JSON/manifest structure, UIKitPlan component whitelist usage, evidence-index-backed support component usage, component SSOT alignment, and the UIKit `quality-report.json` contract. They do NOT check prose quality or subjective wording. If any deterministic item is missing or a gate fails, dispatch only the corresponding Phase 4 generation task, at most 1 retry per file. Retry prompts MUST preserve the same `OutputDir` and absolute `OutputFileAbs` contract; do not downgrade to relative paths. Do not enter Phase 5 until docs and UIKit (when generated) both pass. If retry still fails, stop successful completion and report a failed generation summary. Do NOT dispatch SearchReplace fix tasks.

**First-batch cap: max 6 core components per run (Figma import path). Phase 3 uses ≤3 Task calls per batch (merged intent + preview synthesis). `supportEvidenceComponents` and `components/_evidence` remain available to UIKit for evidence-backed quality coverage. Remaining components are deferred to the expand-components workflow. Users trigger via "继续解析" prompt. Phase 4 dispatches docs first, then UIKit after docs complete.**

**Forbidden pattern**: Main Agent rewriting sub-agent output files to "improve" or "edit" them. Accept sub-agent output as-is unless Quality Gate fails.

---

## Phase 5 — Quality Gate & Complete (Main Agent)

> **User output**: zh: "正在检查..." before validation; then "设计系统已生成完成。" on pass, or "生成已完成，但存在少量缺口。" for known gaps.

### § 5.1 Final Completion Sentinel (BLOCKING)

Successful completion requires, in order:
1. Run `node {SKILL_DIR}/scripts/validate-design-library-output.mjs {output_dir}`.
2. Validator exits with code 0.
3. Package the output directory into a `.zip`.

If final validation fails, do NOT enter a fix loop. Report the failing deterministic gate and treat it as a missed earlier phase gate. Only file presence, standard CSS link, undefined CSS variable, JSON parse, component index, and packaging/manifest issues may be handled deterministically by Main Agent; HTML/CSS/MD content must not be modified in Phase 5 for wording, visual style, screen-count, placeholder, inline-style, React marker, or other non-deterministic concerns.

> **css.json repair — ONLY allowed action**:
> If validator reports ANY css.json failure (missing key, wrong schema, empty section):
> 1. Re-run: `node "{SKILL_DIR}/scripts/css-to-json.mjs" "{output_dir}/colors_and_type.css" --output "{output_dir}/css.json"`
> 2. Re-validate once. If still fails → report failure, do NOT attempt manual edit.
>
> ⛔ **NEVER use Write/Edit/SearchReplace to create or modify css.json.**
> This file is a deterministic derivation from CSS. Manual edits WILL break the
> `{ hex, opacity }` schema and cause front-end crash (TypeError: Cannot read 'hex').

### § 5.2 Cleanup

> The final validator already ran ONCE in § 5.1 (plus at most one re-run after css.json repair). Do NOT run it again here — § 5.1 is the single final validation step.

1. If § 5.1 failed, emit a failed completion summary with the compact validator JSON. Do not dispatch SearchReplace or content-fix Tasks.
2. Clean up temporary directory:
   - Delete `{tmp_dir}` and all its contents.
   - This step is non-blocking — failure to delete does not affect completion status.

---
