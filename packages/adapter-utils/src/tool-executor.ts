import { truncateToolOutput } from "./compression.js";

export interface ToolExecution {
  toolName: string;
  parameters: Record<string, unknown>;
  result: unknown;
  error: string | null;
  durationMs: number;
}

export interface ToolRegistry {
  /**
   * Execute a tool by name with the given input and context.
   * Throws if the tool doesn't exist or execution fails.
   */
  executeTool(
    name: string,
    input: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<unknown>;

  /** Check if a named tool is registered. */
  hasTool(name: string): boolean;

  /** List all registered tool names. */
  listTools(): string[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a single tool call against a tool registry.
 * Captures timing and any errors.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  toolRegistry: ToolRegistry,
  context: Record<string, unknown> = {},
): Promise<ToolExecution> {
  const startTime = Date.now();

  try {
    if (!toolRegistry.hasTool(toolCall.name)) {
      return {
        toolName: toolCall.name,
        parameters: toolCall.input,
        result: null,
        error: `Unknown tool: ${toolCall.name}`,
        durationMs: Date.now() - startTime,
      };
    }

    const result = await toolRegistry.executeTool(toolCall.name, toolCall.input, context);

    return {
      toolName: toolCall.name,
      parameters: toolCall.input,
      result,
      error: null,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      toolName: toolCall.name,
      parameters: toolCall.input,
      result: null,
      error: errorMessage,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute multiple tool calls sequentially, returning results in order.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  toolRegistry: ToolRegistry,
  context: Record<string, unknown> = {},
): Promise<ToolExecution[]> {
  const results: ToolExecution[] = [];
  for (const call of toolCalls) {
    const result = await executeToolCall(call, toolRegistry, context);
    results.push(result);
  }
  return results;
}

/**
 * Execute multiple tool calls in parallel with a concurrency limit.
 */
export async function executeToolCallsParallel(
  toolCalls: ToolCall[],
  toolRegistry: ToolRegistry,
  context: Record<string, unknown> = {},
  concurrency: number = 3,
): Promise<ToolExecution[]> {
  const results: ToolExecution[] = new Array(toolCalls.length);
  const pending: Promise<void>[] = [];
  let index = 0;

  const next = async (): Promise<void> => {
    while (index < toolCalls.length) {
      const currentIndex = index++;
      const call = toolCalls[currentIndex]!;
      results[currentIndex] = await executeToolCall(call, toolRegistry, context);
    }
  };

  for (let i = 0; i < Math.min(concurrency, toolCalls.length); i++) {
    pending.push(next());
  }

  await Promise.all(pending);
  return results;
}

/**
 * Format tool execution results as a message suitable for feeding back
 * to the LLM as a tool_result turn.
 */
export function formatToolResults(executions: ToolExecution[]): string {
  return executions
    .map((exec) => {
      if (exec.error) {
        return `Tool ${exec.toolName}: ERROR - ${exec.error}`;
      }
      const resultStr =
        typeof exec.result === "string"
          ? exec.result
          : JSON.stringify(exec.result, null, 2);
      return `Tool ${exec.toolName}: ${truncateToolOutput(resultStr, exec.toolName)}`;
    })
    .join("\n\n");
}
