/**
 * Use Claude's native prompt caching to avoid re-sending
 * large context blocks (AGENTS.md, SOUL.md, etc)
 *
 * Caching reduces tokens by ~70% for repeated system prompts
 */

export interface CacheablePrompt {
  staticContent: string      // Cached on first turn
  ephemeralContent: string   // Sent every turn
  version: string            // Update if content changes
}

export function createCacheablePrompt(
  staticInstructions: string,
  agentConfig: string,
  ephemeralContext: string
): CacheablePrompt {
  return {
    staticContent: `${staticInstructions}\n${agentConfig}`,
    ephemeralContent: ephemeralContext,
    version: 'v1', // Increment if instructions change
  }
}

/**
 * Build Claude message with cache control
 */
export function buildClaudeMessageWithCache(prompt: CacheablePrompt) {
  return [
    {
      type: 'text' as const,
      text: prompt.staticContent,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: prompt.ephemeralContent,
    },
  ]
}

/**
 * Extract cache usage from Claude response
 */
export function extractCacheMetrics(response: any) {
  const usage = response.usage || {}
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheHit: (usage.cache_read_input_tokens || 0) > 0,
  }
}

export async function runClaudeHeartbeat(context: any) {
  const { claudeClient } = context;
  // Create cacheable prompt structure
  const cacheablePrompt = createCacheablePrompt(
    context.baseInstructions,      // Cached: AGENTS.md, system rules
    context.agentConfig,            // Cached: Agent-specific config
    context.ephemeralContext        // Fresh: Current task, recent messages
  )

  const response = await claudeClient.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: buildClaudeMessageWithCache(cacheablePrompt),
    messages: context.conversationHistory,
    tools: context.tools,
  })

  // Log cache hit ratio
  const metrics = extractCacheMetrics(response)
  console.log('Cache metrics:', {
    cacheHit: metrics.cacheHit,
    cacheReadTokens: metrics.cacheReadTokens,
    newTokens: metrics.inputTokens - metrics.cacheReadTokens,
  })

  return response
}
