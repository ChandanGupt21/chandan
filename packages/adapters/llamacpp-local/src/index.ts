// ---------------------------------------------------------------------------
// llamacpp-local adapter — root package exports
// ---------------------------------------------------------------------------

export const type = "llamacpp_local";
export const label = "Llama.cpp / Local (experimental)";
export const DEFAULT_LLAMACPP_MODEL = "qwen3.5-9b-q4";
export const DEFAULT_LLAMACPP_URL = "http://localhost:8080";

export const models = [
  { id: "qwen3.5-9b-q4", label: "Qwen 3.5 9B (6GB VRAM)" },
  { id: "deepseek-r1:14b", label: "DeepSeek R1 14B (9GB VRAM)" },
  { id: "llama-3.1-8b-q4", label: "Llama 3.1 8B (5GB VRAM)" },
  { id: "codellama-13b-q4", label: "Code Llama 13B (8GB VRAM)" },
  { id: "mistral-7b-q4", label: "Mistral 7B (5GB VRAM)" },
  { id: "phi-3-mini-4k-q4", label: "Phi-3 Mini 4K (3GB VRAM)" },
  { id: "custom", label: "Custom (server-loaded model)" },
];

export const agentConfigurationDoc = `# llamacpp_local agent configuration

Adapter: llamacpp_local (experimental)

Use when:
- You want to run a local LLM via llama.cpp server
- You want zero API costs with on-device inference
- You have sufficient VRAM (6GB+ recommended)

Don't use when:
- You need cloud-grade model quality (use claude_local or gemini_local)
- You don't have a GPU or sufficient VRAM
- You need tool calling with guaranteed reliability

Core fields:
- url (string, optional): llama.cpp server URL. Defaults to http://localhost:8080
- model (string, optional): model identifier. Defaults to qwen3.5-9b-q4
- cwd (string, optional): working directory for the agent
- promptTemplate (string, optional): run prompt template
- instructionsFilePath (string, optional): path to agent instructions file
- maxTokens (number, optional): max tokens per response. Defaults to 2048
- temperature (number, optional): sampling temperature. Defaults to 0.7

Operational fields:
- timeoutSec (number, optional): request timeout in seconds. Defaults to 300
- contextLimit (number, optional): context window size in tokens. Defaults to 8192

Compression fields:
- promptCompression.enabled (boolean, optional): enable prompt compression. Defaults to true
- promptCompression.caveman.enabled (boolean, optional): enable caveman output formatting. Defaults to true
- promptCompression.caveman.intensity (string, optional): "lite" | "full" | "ultra". Defaults to "full"

Notes:
- Requires a running llama.cpp server (llama-server or llama.cpp HTTP server)
- Uses OpenAI-compatible /v1/chat/completions endpoint
- Tool calling support depends on model and server configuration
- Session context is managed in-memory by the adapter
`;
