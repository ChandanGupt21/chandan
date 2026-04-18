import { TrackedTokens } from '../../runtime/token-tracker'
import { ContextTruncator, wrapToolResult } from '../../runtime/context-truncation'

// Mocking some missing imports to let it typecheck if evaluated
declare const claudeClient: any;
declare interface HeartbeatContext {
  agentId: string;
  heartbeatNumber: number;
  conversationHistory: any[];
  systemPrompt: string;
  tools: any[];
  toolResults?: any[];
  baseInstructions: string;
  agentConfig: string;
  ephemeralContext: string;
}

import { TokenTracker, trackTokens } from '../../runtime/token-tracker'

export async function runHeartbeat(context: HeartbeatContext) {
  const truncator = new ContextTruncator()
  const tracker = new TokenTracker()

  // Prune conversation history
  const prunedMessages = truncator.pruneChatHistory(context.conversationHistory)

  // Call model with tracking
  const tracked = trackTokens(context.agentId, context.heartbeatNumber, tracker)
  
  const response = await tracked(async () => {
    return await claudeClient.invoke({
      system: context.systemPrompt,
      messages: prunedMessages,
      tools: context.tools,
    })
  })

  // Wrap tool results with truncation
  const toolResults = context.toolResults?.map(tr =>
    wrapToolResult(tr.name, tr.output, tr.success)
  ) || []

  // Check for alerts
  const alerts = tracker.getAlerts()
  if (alerts.length > 0) {
    console.warn('🚨 Token usage alerts:', alerts)
  }

  return response
}
