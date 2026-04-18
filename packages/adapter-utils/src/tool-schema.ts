// ---------------------------------------------------------------------------
// Tool Schema Generation — convert adapter tools into compact schemas
// for different LLM providers (OpenAI, Gemini, Claude, Llama).
// ---------------------------------------------------------------------------

export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  /** Relevance score 0-1 for prioritization. Higher = more relevant. */
  relevance?: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolSchemaOptions {
  /** Maximum description length (chars). Default: 100 */
  maxDescriptionLength?: number;
  /** Maximum number of tools to include. Default: 15 */
  maxTools?: number;
  /** Sort by relevance score before truncating. Default: true */
  sortByRelevance?: boolean;
}

const DEFAULT_SCHEMA_OPTIONS: Required<ToolSchemaOptions> = {
  maxDescriptionLength: 100,
  maxTools: 15,
  sortByRelevance: true,
};

// ---------------------------------------------------------------------------
// Description compression
// ---------------------------------------------------------------------------

function compressDescription(description: string, maxLength: number): string {
  if (!description) return "";
  let compressed = description.trim();

  // Remove common filler from tool descriptions
  const fillers = [
    /^Use this (?:tool )?to /i,
    /^This (?:tool )?(?:is used to|will) /i,
    /^Call this (?:tool )?to /i,
    /^A tool (?:that|which) /i,
    /^Allows you to /i,
    /^Enables /i,
  ];

  for (const filler of fillers) {
    compressed = compressed.replace(filler, "");
  }

  // Capitalize first letter after filler removal
  if (compressed.length > 0) {
    compressed = compressed.charAt(0).toUpperCase() + compressed.slice(1);
  }

  // Truncate to max length
  if (compressed.length > maxLength) {
    compressed = compressed.slice(0, maxLength - 1) + "…";
  }

  return compressed;
}

// ---------------------------------------------------------------------------
// Core schema builder
// ---------------------------------------------------------------------------

/**
 * Build tool schemas from a list of tools using OpenAI function_calling format.
 * Compresses descriptions and limits tool count.
 */
export function buildToolSchemas(
  tools: Tool[],
  options: ToolSchemaOptions = {},
): ToolSchema[] {
  const opts = { ...DEFAULT_SCHEMA_OPTIONS, ...options };

  // Sort by relevance if requested
  let sorted = [...tools];
  if (opts.sortByRelevance) {
    sorted.sort((a, b) => (b.relevance ?? 0.5) - (a.relevance ?? 0.5));
  }

  // Limit tool count
  const limited = sorted.slice(0, opts.maxTools);

  return limited.map((tool) => ({
    name: tool.name,
    description: compressDescription(tool.description, opts.maxDescriptionLength),
    parameters: tool.parameters ?? { type: "object", properties: {} },
  }));
}

// ---------------------------------------------------------------------------
// Provider-specific schema builders
// ---------------------------------------------------------------------------

/**
 * Build Gemini-format tool declarations.
 *
 * @see https://ai.google.dev/gemini-api/docs/function-calling
 */
export function buildGeminiToolSchema(
  schemas: ToolSchema[],
): { functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> } {
  return {
    functionDeclarations: schemas.map((schema) => ({
      name: schema.name,
      description: schema.description,
      parameters: normalizeParametersForGemini(schema.parameters),
    })),
  };
}

/**
 * Build Claude-format tool declarations.
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */
export function buildClaudeToolSchema(
  schemas: ToolSchema[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return schemas.map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: ensureJsonSchema(schema.parameters),
  }));
}

/**
 * Build llama.cpp / OpenAI-compatible tool declarations.
 *
 * @see https://platform.openai.com/docs/guides/function-calling
 */
export function buildLlamaToolSchema(
  schemas: ToolSchema[],
): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return schemas.map((schema) => ({
    type: "function" as const,
    function: {
      name: schema.name,
      description: schema.description,
      parameters: ensureJsonSchema(schema.parameters),
    },
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure parameters have valid JSON Schema structure.
 * Adds "type": "object" if missing.
 */
function ensureJsonSchema(params: Record<string, unknown>): Record<string, unknown> {
  if (!params || typeof params !== "object") {
    return { type: "object", properties: {} };
  }
  if (!params.type) {
    return { type: "object", ...params };
  }
  return params;
}

/**
 * Gemini requires parameters in a specific subset of JSON Schema.
 * This normalizes common patterns.
 */
function normalizeParametersForGemini(params: Record<string, unknown>): Record<string, unknown> {
  const schema = ensureJsonSchema(params);

  // Gemini doesn't support additionalProperties at the top level
  const cleaned: Record<string, unknown> = { ...schema };
  if ("additionalProperties" in cleaned) {
    delete cleaned.additionalProperties;
  }

  return cleaned;
}

/**
 * Estimate total schema size in bytes (for budget checks).
 */
export function estimateSchemaSize(schemas: ToolSchema[]): number {
  try {
    return JSON.stringify(schemas).length;
  } catch {
    return 0;
  }
}
