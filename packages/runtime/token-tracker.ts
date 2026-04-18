/**
 * Track token usage per agent, per task, per heartbeat
 */

export interface TokenUsage {
  agentId: string
  taskId: string
  heartbeatNumber: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  timestamp: Date
  modelUsed: string
  contextSize: number  // Estimated size of full context
}

export interface TokenAlert {
  agentId: string
  threshold: number
  actual: number
  severity: 'warning' | 'critical'
}

export class TokenTracker {
  private usages: TokenUsage[] = []
  private alerts: TokenAlert[] = []
  
  private thresholds = {
    perHeartbeat: 25000,    // Warn if single heartbeat > 25K
    perDay: 1000000,        // Warn if daily total > 1M
    perAgent: 5000000,      // Warn if agent hits 5M/month
  }

  recordUsage(usage: TokenUsage) {
    this.usages.push(usage)
    this.checkThresholds(usage)
  }

  private checkThresholds(usage: TokenUsage) {
    // Check per-heartbeat threshold
    if (usage.totalTokens > this.thresholds.perHeartbeat) {
      this.alerts.push({
        agentId: usage.agentId,
        threshold: this.thresholds.perHeartbeat,
        actual: usage.totalTokens,
        severity: usage.totalTokens > 50000 ? 'critical' : 'warning',
      })
    }
  }

  getAlerts(): TokenAlert[] {
    return this.alerts
  }

  getUsageSummary(agentId: string, period: 'day' | 'week' | 'month' = 'day') {
    const now = new Date()
    const periodMs = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    }[period]

    const startTime = new Date(now.getTime() - periodMs)
    const relevant = this.usages.filter(
      u => u.agentId === agentId && u.timestamp > startTime
    )

    return {
      agentId,
      period,
      totalTokens: relevant.reduce((sum, u) => sum + u.totalTokens, 0),
      heartbeats: relevant.length,
      avgPerHeartbeat: relevant.length > 0
        ? Math.round(relevant.reduce((sum, u) => sum + u.totalTokens, 0) / relevant.length)
        : 0,
      peakHeartbeat: Math.max(...relevant.map(u => u.totalTokens), 0),
    }
  }
}

/**
 * Middleware for heartbeat handlers
 * Usage:
 * const tracked = trackTokens(async (context) => {
 *   return await agent.run(context)
 * })
 */
export const trackTokens = (
  agentId: string,
  heartbeatNumber: number,
  tracker: TokenTracker
) => {
  return async <T>(handler: () => Promise<T & { usage?: any }>) => {
    const result = await handler()
    
    if (result?.usage) {
      tracker.recordUsage({
        agentId,
        taskId: 'unknown', // Set from context
        heartbeatNumber,
        inputTokens: result.usage.input_tokens || 0,
        outputTokens: result.usage.output_tokens || 0,
        totalTokens: (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0),
        timestamp: new Date(),
        modelUsed: 'unknown', // Set from adapter
        contextSize: 0, // Set from context manager
      })
    }

    return result
  }
}
