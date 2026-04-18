// ---------------------------------------------------------------------------
// llamacpp-local adapter — environment test
// ---------------------------------------------------------------------------

import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_LLAMACPP_URL } from "../index.js";

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = ctx.config;
  const url = asString(config.url, DEFAULT_LLAMACPP_URL).replace(/\/+$/, "");

  // Check 1: Server reachable
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const healthUrl = `${url}/health`;

    try {
      const resp = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
      });

      if (resp.ok) {
        checks.push({
          code: "server_reachable",
          level: "info",
          message: `llama.cpp server reachable at ${url}`,
        });
      } else {
        // Try /v1/models as fallback (some servers don't have /health)
        const modelsResp = await fetch(`${url}/v1/models`, {
          method: "GET",
          signal: controller.signal,
        });

        if (modelsResp.ok) {
          checks.push({
            code: "server_reachable",
            level: "info",
            message: `llama.cpp server reachable at ${url} (via /v1/models)`,
          });
        } else {
          checks.push({
            code: "server_unhealthy",
            level: "error",
            message: `llama.cpp server returned ${resp.status} at ${healthUrl}`,
            hint: "Ensure llama.cpp server is running and healthy",
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    checks.push({
      code: "server_unreachable",
      level: "error",
      message: `Cannot connect to llama.cpp server at ${url}`,
      detail: reason,
      hint: `Start llama.cpp server: llama-server -m <model.gguf> --port 8080`,
    });
  }

  // Check 2: Model loaded (try inference)
  if (checks.every((c) => c.level !== "error")) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      try {
        const resp = await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Say hello in one word." }],
            max_tokens: 10,
            temperature: 0,
          }),
          signal: controller.signal,
        });

        if (resp.ok) {
          const data = parseObject(await resp.json());
          const choices = Array.isArray(data.choices) ? data.choices : [];
          const firstChoice = parseObject(choices[0]);
          const message = parseObject(firstChoice.message);
          const content = asString(message.content, "").trim();

          checks.push({
            code: "inference_ok",
            level: "info",
            message: `Model inference working (response: "${content.slice(0, 50)}")`,
          });
        } else {
          const text = await resp.text().catch(() => "");
          checks.push({
            code: "inference_failed",
            level: "warn",
            message: `Inference test returned ${resp.status}`,
            detail: text.slice(0, 200),
            hint: "Check that a model is loaded on the server",
          });
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      checks.push({
        code: "inference_error",
        level: "warn",
        message: "Inference test failed",
        detail: reason,
        hint: "The server may be loading a model. Try again in a moment.",
      });
    }
  }

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");

  return {
    adapterType: "llamacpp_local",
    status: hasError ? "fail" : hasWarn ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
