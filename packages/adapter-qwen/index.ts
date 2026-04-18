/**
 * Qwen adapter - uses instruction-following instead of function calling
 * Qwen doesn't support structured function calling like Claude/Gemini
 * Instead, we use text-based tool invocation
 */

export interface QwenConfig {
  apiKey: string
  modelName?: string
  maxTokens?: number
}

export class QwenAdapter {
  private config: QwenConfig

  constructor(config: QwenConfig) {
    this.config = {
      modelName: 'qwen-3.5-coder',
      maxTokens: 2048,
      ...config,
    }
  }

  /**
   * Convert tools to instruction text
   * Qwen works better with examples than JSON schemas
   */
  private toolsToInstructions(tools: any[]): string {
    return `
You have access to these tools:

${tools
  .map(
    tool => `
### ${tool.name}
${tool.description}
Usage: ${tool.name}: ${tool.parameters?.description || 'params'}
Example: ${tool.example || tool.name}: example_input
`
  )
  .join('\n')}

When you need to use a tool, write it on its own line like:
TOOL_NAME: argument

Always respond with:
1. Your thinking
2. The tool call(s) if needed
3. Your plan for next steps
`
  }

  /**
   * Parse Qwen's text-based tool output
   */
  private parseToolCalls(text: string): Array<{ name: string; input: any }> {
    const toolCalls = []
    const lines = text.split('\n')

    for (const line of lines) {
      // Match: "TOOL_NAME: argument"
      const match = line.match(/^([A-Z_]+):\s*(.+)$/)
      if (match) {
        const [, toolName, input] = match
        toolCalls.push({
          name: toolName.toLowerCase(),
          input: this.parseInput(toolName, input),
        })
      }
    }

    return toolCalls
  }

  /**
   * Parse tool-specific input format
   */
  private parseInput(toolName: string, input: string) {
    // For most tools, try JSON first, then raw string
    try {
      return JSON.parse(input)
    } catch {
      // Fallback: treat as single argument
      return { arg: input } // depends on tool schema
    }
  }

  /**
   * Main heartbeat handler
   */
  async runHeartbeat(context: any) {
    const systemPrompt = `
You are an AI agent assistant. Follow instructions precisely.
${this.toolsToInstructions(context.tools)}

Your task: ${context.task}
`

    // Call Qwen via local API or proxy
    const response = await this.callQwen(systemPrompt, context.conversationHistory)

    // Parse tool calls from response
    const toolCalls = this.parseToolCalls(response.text)

    return {
      text: response.text,
      toolCalls,
      usage: response.usage,
    }
  }

  private async callQwen(systemPrompt: string, messages: any[]) {
    // This would call local Qwen instance or via OpenRouter
    // For now, placeholder
    const response = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: this.config.maxTokens,
      }),
    })

    return response.json()
  }
}
