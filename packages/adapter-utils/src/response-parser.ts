// ---------------------------------------------------------------------------
// Response Parser — normalize LLM responses from different providers
// into a unified ParsedResponse format.
// ---------------------------------------------------------------------------

export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ParsedResponse {
  text: string;
  toolCalls: ParsedToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
  model?: string;
  finishReason?: string;
}

export type ResponseFormat = "gemini" | "claude" | "llamacpp" | "openai";

// ---------------------------------------------------------------------------
// Provider-specific parsers
// ---------------------------------------------------------------------------

function asStr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNum(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Parse a llama.cpp / OpenAI-compatible response.
 *
 * Expected shape:
 * ```json
 * {
 *   "choices": [{ "message": { "content": "...", "tool_calls": [...] } }],
 *   "usage": { "prompt_tokens": N, "completion_tokens": N }
 * }
 * ```
 */
export function parseLlamaResponse(response: Record<string, unknown>): ParsedResponse {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);

  const text = asStr(message.content, "");
  const finishReason = asStr(firstChoice.finish_reason, "");
  const model = asStr(response.model, "");

  // Parse tool calls
  const toolCalls: ParsedToolCall[] = [];
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const rawCall of rawToolCalls) {
    const call = asRecord(rawCall);
    const fn = asRecord(call.function);
    const name = asStr(fn.name, "");
    if (!name) continue;

    let input: Record<string, unknown> = {};
    const rawArgs = fn.arguments;
    if (typeof rawArgs === "string") {
      try {
        input = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        input = { raw: rawArgs };
      }
    } else if (typeof rawArgs === "object" && rawArgs !== null) {
      input = rawArgs as Record<string, unknown>;
    }

    toolCalls.push({
      id: asStr(call.id, `tool_${toolCalls.length}`),
      name,
      input,
    });
  }

  // Parse usage
  const usage = asRecord(response.usage);

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: asNum(usage.prompt_tokens, 0),
      outputTokens: asNum(usage.completion_tokens, 0),
    },
    model: model || undefined,
    finishReason: finishReason || undefined,
  };
}

/**
 * Parse a Gemini stream-json response event.
 *
 * Gemini uses a different structure with `content.parts` array.
 */
export function parseGeminiResponse(response: Record<string, unknown>): ParsedResponse {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const firstCandidate = asRecord(candidates[0]);
  const content = asRecord(firstCandidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  for (const rawPart of parts) {
    const part = asRecord(rawPart);

    // Text content
    const text = asStr(part.text, "");
    if (text) textParts.push(text);

    // Function call
    const functionCall = asRecord(part.functionCall);
    const fnName = asStr(functionCall.name, "");
    if (fnName) {
      const args = asRecord(functionCall.args);
      toolCalls.push({
        id: `gemini_${toolCalls.length}`,
        name: fnName,
        input: args,
      });
    }
  }

  // Parse usage metadata
  const usageMetadata = asRecord(response.usageMetadata);

  return {
    text: textParts.join("\n"),
    toolCalls,
    usage: {
      inputTokens: asNum(usageMetadata.promptTokenCount, 0),
      outputTokens: asNum(usageMetadata.candidatesTokenCount, 0),
      cachedInputTokens: asNum(usageMetadata.cachedContentTokenCount, 0) || undefined,
    },
    model: asStr(response.modelVersion, "") || undefined,
    finishReason: asStr(firstCandidate.finishReason, "") || undefined,
  };
}

/**
 * Parse a Claude API response.
 *
 * Expected shape:
 * ```json
 * {
 *   "content": [{ "type": "text", "text": "..." }, { "type": "tool_use", ... }],
 *   "usage": { "input_tokens": N, "output_tokens": N }
 * }
 * ```
 */
export function parseClaudeResponse(response: Record<string, unknown>): ParsedResponse {
  const content = Array.isArray(response.content) ? response.content : [];

  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  for (const rawBlock of content) {
    const block = asRecord(rawBlock);
    const type = asStr(block.type, "");

    if (type === "text") {
      const text = asStr(block.text, "");
      if (text) textParts.push(text);
    } else if (type === "tool_use") {
      const name = asStr(block.name, "");
      if (name) {
        toolCalls.push({
          id: asStr(block.id, `claude_${toolCalls.length}`),
          name,
          input: asRecord(block.input),
        });
      }
    }
  }

  const usage = asRecord(response.usage);

  return {
    text: textParts.join("\n"),
    toolCalls,
    usage: {
      inputTokens: asNum(usage.input_tokens, 0),
      outputTokens: asNum(usage.output_tokens, 0),
      cachedInputTokens: asNum(usage.cache_read_input_tokens, 0) || undefined,
    },
    model: asStr(response.model, "") || undefined,
    finishReason: asStr(response.stop_reason, "") || undefined,
  };
}

// ---------------------------------------------------------------------------
// Unified parser
// ---------------------------------------------------------------------------

/**
 * Parse an LLM response using the appropriate provider-specific parser.
 */
export function parseResponse(
  response: Record<string, unknown>,
  format: ResponseFormat,
): ParsedResponse {
  switch (format) {
    case "llamacpp":
    case "openai":
      return parseLlamaResponse(response);
    case "gemini":
      return parseGeminiResponse(response);
    case "claude":
      return parseClaudeResponse(response);
    default:
      // Fallback: try OpenAI format
      return parseLlamaResponse(response);
  }
}
