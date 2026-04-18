/**
 * Convert Paperclip tool schema to Gemini-compatible format
 * Gemini has different parameter requirements and response handling
 */

export interface GeminiToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required?: string[]
  }
}

/**
 * Convert Paperclip tools to Gemini format
 * Key difference: Gemini expects simpler parameter types
 */
export function convertToolsToGemini(tools: any[]): GeminiToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object' as const,
      properties: Object.entries(tool.parameters || {}).reduce((acc, [key, param]: [string, any]) => {
        acc[key] = {
          type: param.type || 'string',
          description: param.description || '',
          ...(param.enum && { enum: param.enum }),
        }
        return acc
      }, {} as Record<string, any>),
      required: tool.required || [],
    },
  }))
}

/**
 * Parse Gemini response format
 * Gemini returns: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] }
 */
export function parseGeminiToolCalls(response: any) {
  const toolCalls = []
  
  try {
    const parts = response.candidates?.[0]?.content?.parts || []
    
    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        })
      }
    }
  } catch (error) {
    console.error('Failed to parse Gemini tool calls:', error)
  }

  return toolCalls
}

/**
 * Gemini-specific error handling
 * Gemini is more lenient with unknown tools; gracefully handle failures
 */
export function handleGeminiToolError(error: Error, toolName: string) {
  // Gemini may return graceful failures instead of throwing
  return {
    success: false,
    tool: toolName,
    error: error.message,
    output: `Tool error: ${toolName} execution failed. ${error.message}`,
  }
}
