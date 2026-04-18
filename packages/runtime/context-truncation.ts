/**
 * Aggressive context truncation to prevent token bloat
 */

export interface TruncationConfig {
  maxShellOutputTokens: number      // Default: 1500
  maxFileReadLines: number          // Default: 50
  maxConversationMessages: number   // Default: 10
  maxAgentInstructionTokens: number // Default: 2000
}

const DEFAULT_CONFIG: TruncationConfig = {
  maxShellOutputTokens: 1500,
  maxFileReadLines: 50,
  maxConversationMessages: 10,
  maxAgentInstructionTokens: 2000,
}

export class ContextTruncator {
  constructor(private config: TruncationConfig = DEFAULT_CONFIG) {}

  /**
   * Truncate shell command output
   * Strategy: Keep first 20 and last 30 lines, summarize middle
   */
  truncateShellOutput(output: string): string {
    const lines = output.split('\n')
    
    // If under 100 lines, return as-is
    if (lines.length <= 100) {
      return output
    }

    const first20 = lines.slice(0, 20).join('\n')
    const last30 = lines.slice(-30).join('\n')
    const middle = `\n\n... [${lines.length - 50} lines omitted - output exceeded ${this.config.maxShellOutputTokens} tokens] ...\n\n`
    
    return first20 + middle + last30
  }

  /**
   * Truncate file reads
   * Strategy: head + tail + line count + size
   */
  truncateFileRead(content: string, filePath: string): string {
    const lines = content.split('\n')
    const sizeKb = Buffer.byteLength(content) / 1024
    
    if (lines.length <= this.config.maxFileReadLines * 2) {
      return content
    }

    const headLines = this.config.maxFileReadLines
    const tailLines = this.config.maxFileReadLines
    
    const head = lines.slice(0, headLines).join('\n')
    const tail = lines.slice(-tailLines).join('\n')
    const summary = `\n\n[File: ${filePath} | Lines: ${lines.length} | Size: ${sizeKb.toFixed(1)}KB]\n[Showing: first ${headLines} and last ${tailLines} lines]\n\n`
    
    return head + summary + tail
  }

  /**
   * Prune conversation history
   * Keep only most recent N messages to prevent exponential growth
   */
  pruneChatHistory(messages: Array<{ role: string; content: string }>) {
    if (messages.length <= this.config.maxConversationMessages) {
      return messages
    }

    // Always keep system message (index 0) and recent messages
    const systemMsg = messages[0]
    const recentMessages = messages.slice(-this.config.maxConversationMessages)
    
    return [systemMsg, ...recentMessages]
  }

  /**
   * Truncate agent instructions
   * Replace full AGENTS.md with cache reference after first turn
   */
  compressAgentInstructions(
    instructions: string,
    isFirstTurn: boolean = false
  ): string {
    if (isFirstTurn) {
      return instructions // Full instructions on first turn
    }

    // Subsequent turns: just reference
    return "[Agent instructions cached - see previous context]"
  }
}

/**
 * Tool result wrapper - automatically truncates outputs
 */
export interface ToolResult {
  tool: string
  success: boolean
  output: string
  truncated?: boolean
  originalLength?: number
}

export const wrapToolResult = (
  tool: string,
  output: string,
  success: boolean = true
): ToolResult => {
  const truncator = new ContextTruncator()
  let finalOutput = output

  if (tool === 'run_shell_command') {
    finalOutput = truncator.truncateShellOutput(output)
  }

  const truncated = finalOutput.length < output.length

  return {
    tool,
    success,
    output: finalOutput,
    truncated,
    originalLength: output.length,
  }
}
