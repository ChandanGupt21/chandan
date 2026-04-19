# 2026-04-19 Prompt Compression & Local Model Adapters

## Context
This plan tracks the rollout of the Paperclip Prompt Compression system and the new `llamacpp-local` adapter. The goal is to optimize local LLM usage by reducing token overhead and providing unified tool calling across diverse local backends.

## Status: COMPLETE (Infrastructure & Wiring)

| Milestone | Status | Details |
|-----------|--------|---------|
| Utility Modules | ✅ Done | `compression`, `caveman`, `tool-schema`, etc. |
| Adapter Wiring  | ✅ Done | Gemini, Claude, Codex local adapters updated. |
| Tool Schema Fix | ✅ Done | Gemini 2.5 explicit tool schema injection. |
| Adapter Registry| ✅ Done | `llamacpp_local` registered in server. |
| Verification    | ✅ Done | 54 unit tests and full typecheck pass. |

## Implementation Details

### Prompt Compression Integration
We have replaced standard prompt joining with a compression-aware flow across all local adapters:
- **Instructions**: Stripped of filler words and articles.
- **Wake Context**: JSON payloads compressed while preserving keys.
- **Bootstrap**: Templates compressed post-rendering.
- **Environment Notes**: Facts preserved, explanations removed.

### Gemini Tool Calling
Gemini 2.5 local execution required a custom schema injection. We added logic to:
1. Normalize Paperclip tools into Gemini-specific function declarations.
2. Inject `--tools` and `--enable-tool-calling` into the CLI execution.
3. Parse `stream-json` output specifically for `function_call` parts.

## Repository Changes (Today)

- **gemini-local**: Updated `execute.ts` and `parse.ts`.
- **claude-local**: Updated `execute.ts` (instructions & prompt).
- **codex-local**: Updated `execute.ts` and resolved `asBoolean` import drift.
- **server**: Updated `src/adapters/registry.ts` to include `llamacpp_local`.

## Next Steps (Future)

- [ ] Add UI controls for compression intensity settings.
- [ ] Implement response streaming for the Llama.cpp adapter.
- [ ] Monitor token savings in production dashboard.

---
Created by Antigravity on 2026-04-19.
