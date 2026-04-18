/**
 * Fix: Ensure Gemini API calls properly report usage
 * Issue: Dashboard shows $0 even though billing confirms charges
 */

declare const db: any;

export async function trackGeminiCosts(
  response: any,
  agentId: string,
  taskId: string
) {
  // Extract usage from Gemini response
  const usage = response.usageMetadata || {}
  
  if (!usage.inputTokenCount && !usage.outputTokenCount) {
    console.warn(
      `⚠️ No usage data in Gemini response for agent ${agentId}. ` +
      `Check if API key is valid and billing is configured.`
    )
    return null
  }

  const costRecord = {
    agentId,
    taskId,
    provider: 'gemini',
    model: response.model || 'gemini-2.5-pro',
    inputTokens: usage.inputTokenCount || 0,
    outputTokens: usage.outputTokenCount || 0,
    totalTokens: (usage.inputTokenCount || 0) + (usage.outputTokenCount || 0),
    costUSD: calculateGeminiCost(
      usage.inputTokenCount || 0,
      usage.outputTokenCount || 0
    ),
    timestamp: new Date(),
  }

  // Store in database
  if (typeof db !== 'undefined') {
    await db.costs.insert(costRecord)
  }

  return costRecord
}

function calculateGeminiCost(inputTokens: number, outputTokens: number): number {
  // Gemini 2.5 Pro pricing (as of 2026)
  const inputCostPerMtoken = 0.075  // $0.075 per 1M input tokens
  const outputCostPerMtoken = 0.30  // $0.30 per 1M output tokens

  return (
    (inputTokens / 1_000_000) * inputCostPerMtoken +
    (outputTokens / 1_000_000) * outputCostPerMtoken
  )
}

export async function processGeminiResponse(response: any, context: any) {
  // Track costs
  const costRecord = await trackGeminiCosts(
    response,
    context.agentId,
    context.taskId
  )

  if (costRecord) {
    console.log(`💰 Cost tracked: $${costRecord.costUSD.toFixed(4)}`)
  }

  return response
}
