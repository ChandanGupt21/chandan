import { convertToolsToGemini, parseGeminiToolCalls } from './tool-schema-mapper'
import { ContextTruncator, wrapToolResult } from '../../runtime/context-truncation'

declare const geminiClient: any;
declare const executeTool: (tool: any, input: any) => Promise<any>;

export async function runGeminiHeartbeat(context: any) {
  const truncator = new ContextTruncator()

  // Convert tools to Gemini format
  const geminiTools = convertToolsToGemini(context.tools)

  // Prune messages
  const messages = truncator.pruneChatHistory(context.conversationHistory)

  // Call Gemini with proper tool schema
  const response = await geminiClient.generateContent({
    model: 'gemini-2.5-pro',
    systemInstruction: context.systemPrompt,
    contents: messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    tools: [
      {
        functionDeclarations: geminiTools,
      },
    ],
  })

  // Parse tool calls from Gemini response
  const toolCalls = parseGeminiToolCalls(response)

  // Process tool calls and wrap results
  for (const toolCall of toolCalls) {
    const tool = context.tools.find((t: any) => t.name === toolCall.name)
    if (!tool) continue

    const result = await executeTool(tool, toolCall.input)
    const wrapped = wrapToolResult(toolCall.name, result.output, result.success)
    
    // Add wrapped result to conversation
    messages.push({
      role: 'user',
      content: `Tool result for ${wrapped.tool}: ${wrapped.output}`,
    })
  }

  return {
    success: true,
    toolCalls,
    nextMessage: response.text,
  }
}
