// ---------------------------------------------------------------------------
// llamacpp-local adapter — skill registry interface
//
// Placeholder for tool/skill registration. The llamacpp adapter uses the
// shared tool-schema module from adapter-utils for tool declaration and
// relies on the Paperclip harness for actual tool execution.
// ---------------------------------------------------------------------------

import type { AdapterSkillContext, AdapterSkillSnapshot } from "@paperclipai/adapter-utils";

/**
 * List skills available for the llamacpp adapter.
 * Currently returns an unsupported snapshot since llamacpp doesn't have
 * native skill management like Claude or Gemini CLIs.
 */
export async function listSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return {
    adapterType: ctx.adapterType,
    supported: false,
    mode: "unsupported",
    desiredSkills: [],
    entries: [],
    warnings: [
      "llamacpp_local does not support native skill management. " +
        "Tools are passed via the OpenAI-compatible tool_calling API.",
    ],
  };
}
