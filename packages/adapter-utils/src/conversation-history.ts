// ---------------------------------------------------------------------------
// Conversation History — context window management for multi-turn sessions.
// Keeps recent turns, summarizes old ones, and trims to fit context limits.
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Estimated token count for this turn */
  tokens: number;
  timestamp: number;
  /** Optional metadata (tool calls, cost, etc.) */
  metadata?: Record<string, unknown>;
}

export interface ConversationContext {
  sessionId: string;
  turns: ConversationTurn[];
  totalTokens: number;
  contextLimit: number;
}

// ---------------------------------------------------------------------------
// Token estimation (rough heuristic — 1 token ≈ 4 chars for English)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

/**
 * Rough token count estimate for a string.
 * Not a substitute for real tokenizer, but fast and good enough for budgeting.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

/**
 * Build a conversation context from raw turns, trimming to fit the context limit.
 */
export function buildConversationContext(
  sessionId: string,
  turns: ConversationTurn[],
  contextLimit: number,
): ConversationContext {
  const trimmed = trimToContextWindow(turns, contextLimit);
  const totalTokens = trimmed.reduce((sum, turn) => sum + turn.tokens, 0);

  return {
    sessionId,
    turns: trimmed,
    totalTokens,
    contextLimit,
  };
}

/**
 * Trim turns to fit within the context window.
 *
 * Strategy:
 * - Always keep the last 3 turns (most recent context is most valuable)
 * - Summarize turns 4..N into a single system turn
 * - If even the last 3 don't fit, trim the oldest of the 3
 */
export function trimToContextWindow(
  turns: ConversationTurn[],
  maxTokens: number,
): ConversationTurn[] {
  if (turns.length === 0) return [];

  const totalTokens = turns.reduce((sum, turn) => sum + turn.tokens, 0);

  // If everything fits, return as-is
  if (totalTokens <= maxTokens) return [...turns];

  // Reserve last 3 turns
  const KEEP_RECENT = 3;
  const recentTurns = turns.slice(-KEEP_RECENT);
  const olderTurns = turns.slice(0, -KEEP_RECENT);

  // Check if recent turns alone fit
  const recentTokens = recentTurns.reduce((sum, turn) => sum + turn.tokens, 0);

  if (olderTurns.length === 0) {
    // Only have <= 3 turns, start trimming from oldest
    return trimFromOldest(turns, maxTokens);
  }

  // Summarize older turns
  const summary = summarizeTurns(olderTurns);
  const summaryTokens = estimateTokens(summary);

  if (summaryTokens + recentTokens <= maxTokens) {
    // Summary + recent fits
    return [
      {
        role: "system",
        content: summary,
        tokens: summaryTokens,
        timestamp: olderTurns[0]?.timestamp ?? Date.now(),
        metadata: { isSummary: true, summarizedCount: olderTurns.length },
      },
      ...recentTurns,
    ];
  }

  // Summary doesn't fit — try with just recent turns
  if (recentTokens <= maxTokens) {
    return recentTurns;
  }

  // Even recent turns don't fit — trim from oldest
  return trimFromOldest(recentTurns, maxTokens);
}

/**
 * Trim turns from the oldest first until the total fits.
 */
function trimFromOldest(turns: ConversationTurn[], maxTokens: number): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let remaining = maxTokens;

  // Work backwards (newest first)
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.tokens <= remaining) {
      result.unshift(turn);
      remaining -= turn.tokens;
    } else {
      // Truncate this turn's content to fit
      const availableChars = remaining * CHARS_PER_TOKEN;
      if (availableChars > 50) {
        // Only include if we can fit meaningful content
        result.unshift({
          ...turn,
          content: turn.content.slice(0, availableChars) + "\n[...truncated]",
          tokens: remaining,
        });
      }
      break;
    }
  }

  return result;
}

/**
 * Summarize a list of turns into a compact text.
 */
function summarizeTurns(turns: ConversationTurn[]): string {
  if (turns.length === 0) return "";

  const userMsgs: string[] = [];
  const assistantActions: string[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      // Extract first line or meaningful snippet
      const firstLine = turn.content.split("\n")[0]?.trim() ?? "";
      if (firstLine) userMsgs.push(firstLine.slice(0, 100));
    } else if (turn.role === "assistant") {
      const firstLine = turn.content.split("\n")[0]?.trim() ?? "";
      if (firstLine) assistantActions.push(firstLine.slice(0, 100));
    }
  }

  const parts: string[] = [`Previous context (${turns.length} turns summarized):`];

  if (userMsgs.length > 0) {
    parts.push(`User asked: ${userMsgs.join("; ")}`);
  }
  if (assistantActions.length > 0) {
    parts.push(`Did: ${assistantActions.join("; ")}`);
  }

  return parts.join("\n");
}

/**
 * Create a new conversation turn.
 */
export function createTurn(
  role: ConversationTurn["role"],
  content: string,
  metadata?: Record<string, unknown>,
): ConversationTurn {
  return {
    role,
    content,
    tokens: estimateTokens(content),
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * Append a turn to a context and re-trim if necessary.
 */
export function appendTurnToContext(
  context: ConversationContext,
  turn: ConversationTurn,
): ConversationContext {
  const allTurns = [...context.turns, turn];
  return buildConversationContext(context.sessionId, allTurns, context.contextLimit);
}
