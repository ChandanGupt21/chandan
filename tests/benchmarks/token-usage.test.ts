import { describe, it, expect } from 'vitest'
import { TokenTracker } from '../../packages/runtime/token-tracker'
import { ContextTruncator } from '../../packages/runtime/context-truncation'

describe('Token Usage Benchmarks', () => {
  it('should reduce heartbeat tokens by 80%+ with truncation', async () => {
    const truncator = new ContextTruncator()

    // Simulate large shell output
    const largeOutput = Array(1000).fill('output line\n').join('')
    const truncated = truncator.truncateShellOutput(largeOutput)

    // Should be much smaller
    expect(truncated.length).toBeLessThan(largeOutput.length * 0.2)
  })

  it('should prune conversation history correctly', () => {
    const truncator = new ContextTruncator({
      maxConversationMessages: 5,
      maxShellOutputTokens: 1500,
      maxFileReadLines: 50,
      maxAgentInstructionTokens: 2000,
    })
    const longHistory = Array(20)
      .fill(null)
      .map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }))

    const pruned = truncator.pruneChatHistory(longHistory)
    expect(pruned.length).toBeLessThanOrEqual(5)
  })

  it('should track token usage per heartbeat', () => {
    const tracker = new TokenTracker()

    tracker.recordUsage({
      agentId: 'test-agent',
      taskId: 'test-task',
      heartbeatNumber: 1,
      inputTokens: 5000,
      outputTokens: 2000,
      totalTokens: 7000,
      timestamp: new Date(),
      modelUsed: 'claude-opus',
      contextSize: 3000,
    })

    const summary = tracker.getUsageSummary('test-agent', 'day')
    expect(summary.totalTokens).toBe(7000)
    expect(summary.avgPerHeartbeat).toBe(7000)
  })

  it('should alert on excessive token usage', () => {
    const tracker = new TokenTracker()

    tracker.recordUsage({
      agentId: 'test-agent',
      taskId: 'test-task',
      heartbeatNumber: 1,
      inputTokens: 40000,  // Exceeds threshold
      outputTokens: 15000,
      totalTokens: 55000,
      timestamp: new Date(),
      modelUsed: 'claude-opus',
      contextSize: 3000,
    })

    const alerts = tracker.getAlerts()
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0].severity).toBe('critical')
  })
})

describe('Gemini Tool Calling', () => {
  it('should convert tools to Gemini format correctly', async () => {
    const tools = [
      {
        name: 'run_command',
        description: 'Run a shell command',
        parameters: {
          command: { type: 'string', description: 'Command to run' },
        },
      },
    ]

    const { convertToolsToGemini } = await import(
      '../../packages/adapter-gemini/tool-schema-mapper'
    )
    const geminiTools = convertToolsToGemini(tools)

    expect(geminiTools[0].name).toBe('run_command')
    expect(geminiTools[0].parameters.type).toBe('object')
  })

  it('should parse Gemini response format correctly', async () => {
    const geminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'run_command',
                  args: { command: 'npm test' },
                },
              },
            ],
          },
        },
      ],
    }

    const { parseGeminiToolCalls } = await import(
      '../../packages/adapter-gemini/tool-schema-mapper'
    )
    const calls = parseGeminiToolCalls(geminiResponse)

    expect(calls.length).toBe(1)
    expect(calls[0].name).toBe('run_command')
  })
})
