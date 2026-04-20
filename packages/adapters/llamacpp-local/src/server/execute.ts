// ---------------------------------------------------------------------------
// llamacpp-local adapter — main execution logic
//
// Calls a llama.cpp server via the OpenAI-compatible /v1/chat/completions
// endpoint. Manages conversation history in-memory and applies prompt
// compression + caveman formatting to reduce token usage.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  asBoolean,
  parseObject,
  joinPromptSections,
  renderTemplate,
  renderPaperclipWakePrompt,
  ensureAbsoluteDirectory,
} from "@paperclipai/adapter-utils/server-utils";
import {
  compressInstructions,
  compressBootstrapPrompt,
  compressWakeContext,
  compressEnvironmentNotes,
  compressApiNotes,
} from "@paperclipai/adapter-utils/compression";
import { formatCaveman } from "@paperclipai/adapter-utils/caveman-formatter";
import {
  buildToolSchemas,
  buildLlamaToolSchema,
} from "@paperclipai/adapter-utils/tool-schema";
import {
  buildConversationContext,
  createTurn,
} from "@paperclipai/adapter-utils/conversation-history";
import { parseLlamaResponse } from "@paperclipai/adapter-utils/response-parser";
import type { ConversationTurn } from "@paperclipai/adapter-utils/conversation-history";
import type { Tool } from "@paperclipai/adapter-utils/tool-schema";
import type { CavemanIntensity } from "@paperclipai/adapter-utils/caveman-formatter";

import { DEFAULT_LLAMACPP_MODEL, DEFAULT_LLAMACPP_URL } from "../index.js";

// ---------------------------------------------------------------------------
// In-memory session store (per-adapter instance)
// ---------------------------------------------------------------------------

const sessionStore = new Map<string, ConversationTurn[]>();

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface LlamaCppConfig {
  url: string;
  model: string;
  cwd: string;
  maxTokens: number;
  temperature: number;
  timeoutSec: number;
  contextLimit: number;
  compressionEnabled: boolean;
  cavemanEnabled: boolean;
  cavemanIntensity: CavemanIntensity;
}

function resolveConfig(config: Record<string, unknown>, cwd: string): LlamaCppConfig {
  const compression = parseObject(config.promptCompression);
  const caveman = parseObject(compression.caveman);

  return {
    url: asString(config.url, DEFAULT_LLAMACPP_URL).replace(/\/+$/, ""),
    model: asString(config.model, DEFAULT_LLAMACPP_MODEL),
    cwd,
    maxTokens: asNumber(config.maxTokens, 2048),
    temperature: asNumber(config.temperature, 0.7),
    timeoutSec: asNumber(config.timeoutSec, 300),
    contextLimit: asNumber(config.contextLimit, 8192),
    compressionEnabled: asBoolean(compression.enabled, true),
    cavemanEnabled: asBoolean(caveman.enabled, true),
    cavemanIntensity: (asString(caveman.intensity, "full") as CavemanIntensity),
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function llamaCppRequest(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`llama.cpp server returned ${response.status}: ${text.slice(0, 500)}`);
    }

    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta } = ctx;

  // Resolve workspace and cwd
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const cfg = resolveConfig(config, cwd);

  // Build prompt sections
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };

  // Load instructions file
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      const instructionsDir = `${path.dirname(instructionsFilePath)}/`;
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `Instructions loaded from ${instructionsFilePath}. ` +
        `Resolve relative refs from ${instructionsDir}.\n\n`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read instructions "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }

  // Session handling
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const sessionKey = asString(runtimeSessionParams.sessionKey, `${agent.id}:${cwd}`);
  const existingTurns = sessionStore.get(sessionKey) ?? [];
  const isResumedSession = existingTurns.length > 0;

  // Build prompt
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const renderedBootstrapPrompt =
    !isResumedSession && bootstrapPromptTemplate.trim().length > 0
      ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
      : "";
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, {
    resumedSession: isResumedSession,
  });
  const shouldUseResumeDelta = isResumedSession && wakePrompt.length > 0;
  const renderedPrompt = shouldUseResumeDelta
    ? ""
    : renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();

  // Apply compression if enabled
  const env: Record<string, string> = {
    PAPERCLIP_AGENT_ID: agent.id,
    PAPERCLIP_COMPANY_ID: agent.companyId,
    PAPERCLIP_RUN_ID: runId,
  };

  let finalSections: Array<string | null | undefined>;
  if (cfg.compressionEnabled) {
    finalSections = [
      instructionsPrefix ? compressInstructions(instructionsPrefix) : "",
      renderedBootstrapPrompt ? compressBootstrapPrompt(renderedBootstrapPrompt) : "",
      wakePrompt ? compressWakeContext(context.paperclipWake) : "",
      sessionHandoffNote,
      compressEnvironmentNotes(env),
      compressApiNotes(),
      renderedPrompt,
    ];
  } else {
    finalSections = [
      instructionsPrefix,
      renderedBootstrapPrompt,
      wakePrompt,
      sessionHandoffNote,
      renderedPrompt,
    ];
  }

  const prompt = joinPromptSections(finalSections);

  const promptMetrics: Record<string, number> = {
    promptChars: prompt.length,
    compressionEnabled: cfg.compressionEnabled ? 1 : 0,
    cavemanEnabled: cfg.cavemanEnabled ? 1 : 0,
  };

  if (onMeta) {
    await onMeta({
      adapterType: "llamacpp_local",
      command: `POST ${cfg.url}/v1/chat/completions`,
      cwd,
      commandNotes: [
        `Model: ${cfg.model}`,
        `Context limit: ${cfg.contextLimit}`,
        `Compression: ${cfg.compressionEnabled ? "on" : "off"}`,
        `Caveman: ${cfg.cavemanEnabled ? cfg.cavemanIntensity : "off"}`,
      ],
      prompt,
      promptMetrics,
      context,
    });
  }

  // Build messages array with conversation history
  const messages: Array<{ role: string; content: string }> = [];

  // System message (only if not resumed)
  if (instructionsPrefix && !isResumedSession) {
    const sysContent = cfg.compressionEnabled
      ? compressInstructions(instructionsPrefix)
      : instructionsPrefix;
    messages.push({ role: "system", content: sysContent });
  }

  // Previous conversation turns
  const conversationContext = buildConversationContext(
    sessionKey,
    existingTurns,
    cfg.contextLimit,
  );
  for (const turn of conversationContext.turns) {
    messages.push({ role: turn.role, content: turn.content });
  }

  // Current user message
  messages.push({ role: "user", content: prompt });

  // Build tool schemas if tools are available
  const tools = parseObject(config.tools);
  const toolList = Array.isArray(tools.list) ? tools.list : [];
  const toolSchemas = toolList.length > 0
    ? buildLlamaToolSchema(buildToolSchemas(toolList as Tool[]))
    : undefined;

  // Make the API call
  const requestBody: Record<string, unknown> = {
    messages,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    stream: false,
  };
  if (cfg.model !== "custom") {
    requestBody.model = cfg.model;
  }
  if (toolSchemas && toolSchemas.length > 0) {
    requestBody.tools = toolSchemas;
    requestBody.tool_choice = "auto";
  }

  const startTime = Date.now();
  await onLog("stdout", `[paperclip] Calling llama.cpp server at ${cfg.url}...\n`);

  try {
    const rawResponse = await llamaCppRequest(
      `${cfg.url}/v1/chat/completions`,
      requestBody,
      cfg.timeoutSec * 1000,
    );

    const durationMs = Date.now() - startTime;
    const parsed = parseLlamaResponse(rawResponse);

    await onLog(
      "stdout",
      `[paperclip] Response received in ${durationMs}ms (${parsed.usage.inputTokens}+${parsed.usage.outputTokens} tokens)\n`,
    );

    // Apply caveman formatting to the output if enabled
    let outputText = parsed.text;
    if (cfg.cavemanEnabled && outputText) {
      const original = outputText;
      outputText = formatCaveman(outputText, {
        intensity: cfg.cavemanIntensity,
        preserveCodeBlocks: true,
        preserveJsonOutput: true,
      });
      const savedChars = original.length - outputText.length;
      if (savedChars > 0) {
        await onLog(
          "stderr",
          `[paperclip] Caveman formatting saved ${savedChars} chars (${Math.round((savedChars / original.length) * 100)}% reduction)\n`,
        );
      }
    }

    // Log the response
    if (outputText) {
      await onLog("stdout", outputText + "\n");
    }

    // Save conversation turns
    const newUserTurn = createTurn("user", prompt);
    const newAssistantTurn = createTurn("assistant", outputText);
    const updatedTurns = [...existingTurns, newUserTurn, newAssistantTurn];
    sessionStore.set(sessionKey, updatedTurns);

    // Handle tool calls
    if (parsed.toolCalls.length > 0) {
      await onLog(
        "stdout",
        `[paperclip] Tool calls requested: ${parsed.toolCalls.map((tc) => tc.name).join(", ")}\n`,
      );
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: {
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
      },
      sessionId: sessionKey,
      sessionParams: { sessionKey, cwd },
      sessionDisplayId: sessionKey,
      provider: "llamacpp",
      biller: "local",
      model: cfg.model,
      billingType: "fixed",
      costUsd: 0,
      summary: outputText,
      resultJson: rawResponse,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMessage = err instanceof Error ? err.message : String(err);

    await onLog(
      "stderr",
      `[paperclip] llama.cpp request failed after ${durationMs}ms: ${errorMessage}\n`,
    );

    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage: isTimeout
        ? `Timed out after ${cfg.timeoutSec}s`
        : `llama.cpp error: ${errorMessage}`,
      errorCode: isTimeout ? "timeout" : "llamacpp_error",
      sessionId: sessionKey,
      sessionParams: { sessionKey, cwd },
      sessionDisplayId: sessionKey,
      provider: "llamacpp",
      biller: "local",
      model: cfg.model,
      billingType: "fixed",
      costUsd: 0,
    };
  }
}
