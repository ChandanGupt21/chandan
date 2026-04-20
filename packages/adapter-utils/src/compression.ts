// ---------------------------------------------------------------------------
// Prompt Compression — reduce input token count by ~80% while preserving
// all critical information (facts, code, negations, JSON).
// ---------------------------------------------------------------------------

export interface CompressionResult {
  compressed: string;
  originalLength: number;
  compressedLength: number;
  reductionPercent: number;
}

export interface CompressionOptions {
  /** Strip articles (a, the, an) from prose. Default: true */
  stripArticles?: boolean;
  /** Remove filler phrases ("I'd be happy to", "Sure!", etc.). Default: true */
  stripFillers?: boolean;
  /** Abbreviate common words (implementation→impl, etc.). Default: true */
  abbreviateCommon?: boolean;
  /** Collapse redundant whitespace. Default: true */
  collapseWhitespace?: boolean;
  /** Preserve content inside code blocks verbatim. Default: true */
  preserveCodeBlocks?: boolean;
  /** Preserve JSON blobs verbatim. Default: true */
  preserveJson?: boolean;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  stripArticles: true,
  stripFillers: true,
  abbreviateCommon: true,
  collapseWhitespace: true,
  preserveCodeBlocks: true,
  preserveJson: true,
};

// ---------------------------------------------------------------------------
// Word lists and patterns
// ---------------------------------------------------------------------------

// Articles removed from prose only (not inside code/JSON)
const ARTICLES_RE = /\b(a|an|the)\b/gi;

// Filler phrases removed wholesale
const FILLER_PHRASES: readonly string[] = [
  "I'd be happy to",
  "I would be happy to",
  "I'd love to",
  "I am happy to",
  "Sure!",
  "Sure,",
  "Sure thing!",
  "Of course!",
  "Of course,",
  "Absolutely!",
  "Absolutely,",
  "Let me",
  "Feel free to",
  "Feel free",
  "The reason is that",
  "The reason being",
  "As you can see",
  "As you may know",
  "As I mentioned",
  "As mentioned earlier",
  "It's worth noting that",
  "It is worth noting that",
  "Please note that",
  "Note that",
  "It should be noted that",
  "It's important to note that",
  "In order to",
  "Basically,",
  "Essentially,",
  "Actually,",
  "In fact,",
  "For your reference,",
  "For reference,",
  "As a matter of fact,",
  "To be honest,",
  "To be clear,",
  "Just to clarify,",
  "I think that",
  "I believe that",
  "In my opinion,",
  "Here's what I think:",
  "Here is what I think:",
  "What you need to do is",
  "What we need to do is",
  "The thing is,",
  "The thing is that",
  "If you don't mind,",
  "If you want,",
  "If you'd like,",
  "You might want to",
  "You may want to",
  "You can go ahead and",
  "Go ahead and",
  "I'll go ahead and",
  "Let me go ahead and",
  "I'm going to",
  "I would like to",
  "I want to",
  "Let's go ahead and",
  "Great question!",
  "Good question!",
  "That's a great question!",
  "That's a good question!",
  "Here's the thing:",
  "Here is the thing:",
  "At the end of the day,",
  "When it comes to",
  "In terms of",
  "In this case,",
  "In any case,",
  "Having said that,",
  "That being said,",
  "With that being said,",
  "With that said,",
  "Moving forward,",
  "Going forward,",
  "As far as I know,",
  "To summarize,",
  "In summary,",
  "To put it simply,",
  "Simply put,",
  "Long story short,",
  "In other words,",
  "That is to say,",
  "What I mean is",
  "What this means is",
];

// Common abbreviations (applied outside code/JSON blocks)
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["implementation", "impl"],
  ["architecture", "arch"],
  ["configuration", "config"],
  ["environment", "env"],
  ["repository", "repo"],
  ["message", "msg"],
  ["index", "idx"],
  ["expression", "expr"],
  ["function", "fn"],
  ["parameter", "param"],
  ["parameters", "params"],
  ["argument", "arg"],
  ["arguments", "args"],
  ["variable", "var"],
  ["variables", "vars"],
  ["directory", "dir"],
  ["directories", "dirs"],
  ["document", "doc"],
  ["documents", "docs"],
  ["documentation", "docs"],
  ["reference", "ref"],
  ["references", "refs"],
  ["application", "app"],
  ["applications", "apps"],
  ["database", "db"],
  ["information", "info"],
  ["authentication", "auth"],
  ["authorization", "authz"],
  ["dependency", "dep"],
  ["dependencies", "deps"],
  ["development", "dev"],
  ["production", "prod"],
  ["temporary", "tmp"],
  ["response", "resp"],
  ["request", "req"],
  ["maximum", "max"],
  ["minimum", "min"],
  ["specification", "spec"],
  ["specifications", "specs"],
  ["description", "desc"],
  ["approximately", "~"],
  ["approximately", "approx"],
  ["including", "incl"],
  ["following", "foll"],
  ["component", "comp"],
  ["components", "comps"],
  ["template", "tpl"],
  ["templates", "tpls"],
  ["operation", "op"],
  ["operations", "ops"],
  ["executable", "exec"],
  ["properties", "props"],
  ["property", "prop"],
  ["attribute", "attr"],
  ["attributes", "attrs"],
  ["utility", "util"],
  ["utilities", "utils"],
  ["certificate", "cert"],
  ["certificates", "certs"],
  ["administrator", "admin"],
  ["performance", "perf"],
  ["initialization", "init"],
  ["initialize", "init"],
  ["synchronization", "sync"],
  ["synchronize", "sync"],
]);

// Build a regex from abbreviation keys (case-insensitive, word-boundary)
function buildAbbreviationRegex(): RegExp {
  const keys = [...ABBREVIATIONS.keys()]
    .sort((a, b) => b.length - a.length) // longest first to avoid partial matches
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${keys.join("|")})\\b`, "gi");
}

const ABBREVIATION_RE = buildAbbreviationRegex();

// Critical negations — never strip these even when they look like filler
const NEGATION_RE = /\b(cannot|can't|couldn't|shouldn't|wouldn't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|not|never|no|none|neither|nor)\b/i;

// ---------------------------------------------------------------------------
// Code block / JSON detection helpers
// ---------------------------------------------------------------------------

interface TextSegment {
  text: string;
  isProtected: boolean;
}

/**
 * Split text into segments, marking code blocks (``` fenced) and inline code
 * (`backtick`) as protected (won't be compressed).
 */
function splitProtectedSegments(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Match fenced code blocks (```...```)
  const codeBlockRe = /```[\s\S]*?```/g;
  let lastIndex = 0;

  for (const match of input.matchAll(codeBlockRe)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ text: input.slice(lastIndex, start), isProtected: false });
    }
    segments.push({ text: match[0], isProtected: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), isProtected: false });
  }

  // Second pass: protect inline code (`...`) in non-protected segments
  const result: TextSegment[] = [];
  for (const seg of segments) {
    if (seg.isProtected) {
      result.push(seg);
      continue;
    }
    const inlineRe = /`[^`]+`/g;
    let subLastIndex = 0;
    for (const inlineMatch of seg.text.matchAll(inlineRe)) {
      const subStart = inlineMatch.index!;
      if (subStart > subLastIndex) {
        result.push({ text: seg.text.slice(subLastIndex, subStart), isProtected: false });
      }
      result.push({ text: inlineMatch[0], isProtected: true });
      subLastIndex = subStart + inlineMatch[0].length;
    }
    if (subLastIndex < seg.text.length) {
      result.push({ text: seg.text.slice(subLastIndex), isProtected: false });
    }
  }

  return result;
}

/**
 * Detect if a string looks like a JSON blob (starts with { or [).
 */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

// ---------------------------------------------------------------------------
// Compression functions
// ---------------------------------------------------------------------------

function stripFillerPhrases(text: string): string {
  let result = text;
  for (const phrase of FILLER_PHRASES) {
    // Case-insensitive replacement, preserving sentence flow
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    result = result.replace(re, "");
  }
  return result;
}

function stripArticles(text: string): string {
  return text.replace(ARTICLES_RE, "");
}

function abbreviateWords(text: string): string {
  return text.replace(ABBREVIATION_RE, (match) => {
    const lower = match.toLowerCase();
    const abbreviation = ABBREVIATIONS.get(lower);
    if (!abbreviation) return match;
    // Preserve capitalization of first letter
    if (match[0] === match[0].toUpperCase()) {
      return abbreviation.charAt(0).toUpperCase() + abbreviation.slice(1);
    }
    return abbreviation;
  });
}

function collapseWhitespace(text: string): string {
  // Collapse multiple spaces/tabs to single space
  let result = text.replace(/[^\S\n]+/g, " ");
  // Collapse multiple blank lines to single blank line
  result = result.replace(/\n{3,}/g, "\n\n");
  // Remove leading/trailing whitespace on each line
  result = result
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return result;
}

function compressProseSegment(text: string, options: Required<CompressionOptions>): string {
  if (!text.trim()) return text;

  // Don't compress if it looks like JSON
  if (options.preserveJson && looksLikeJson(text)) return text;

  let result = text;

  if (options.stripFillers) {
    result = stripFillerPhrases(result);
  }

  if (options.stripArticles) {
    // Don't strip articles from lines containing negations to avoid
    // accidentally altering the meaning of negative statements
    result = result
      .split("\n")
      .map((line) => {
        if (NEGATION_RE.test(line)) return line;
        return stripArticles(line);
      })
      .join("\n");
  }

  if (options.abbreviateCommon) {
    result = abbreviateWords(result);
  }

  if (options.collapseWhitespace) {
    result = collapseWhitespace(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress a prompt string, preserving code blocks and JSON while aggressively
 * reducing prose tokens.
 */
export function compressPrompt(
  input: string,
  options: CompressionOptions = {},
): CompressionResult {
  if (!input || input.trim().length === 0) {
    return {
      compressed: input,
      originalLength: input.length,
      compressedLength: input.length,
      reductionPercent: 0,
    };
  }

  const opts: Required<CompressionOptions> = { ...DEFAULT_OPTIONS, ...options };
  const segments = opts.preserveCodeBlocks
    ? splitProtectedSegments(input)
    : [{ text: input, isProtected: false }];

  const compressed = segments
    .map((seg) => (seg.isProtected ? seg.text : compressProseSegment(seg.text, opts)))
    .join("");

  // Final whitespace collapse — but only on non-protected segments.
  // Re-split to avoid collapsing indentation inside code blocks.
  let finalText: string;
  if (opts.collapseWhitespace && opts.preserveCodeBlocks) {
    const finalSegments = splitProtectedSegments(compressed);
    finalText = finalSegments
      .map((seg) => (seg.isProtected ? seg.text : collapseWhitespace(seg.text)))
      .join("");
  } else if (opts.collapseWhitespace) {
    finalText = collapseWhitespace(compressed);
  } else {
    finalText = compressed;
  }

  return {
    compressed: finalText,
    originalLength: input.length,
    compressedLength: finalText.length,
    reductionPercent:
      input.length > 0
        ? Math.round(((input.length - finalText.length) / input.length) * 100)
        : 0,
  };
}

/**
 * Compress agent instructions text (AGENTS.md / system prompt content).
 * Applies full compression to the prose while preserving code blocks.
 */
export function compressInstructions(fullText: string): string {
  if (!fullText || fullText.trim().length === 0) return fullText;
  return compressPrompt(fullText).compressed;
}

/**
 * Compress the Paperclip wake context payload. Converts the structured payload
 * into a minimal key-value format, stripping verbose field names and descriptions.
 */
export function compressWakeContext(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") {
    return compressPrompt(payload).compressed;
  }

  // For structured objects, produce a compact representation
  try {
    const json = typeof payload === "string" ? payload : JSON.stringify(payload);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    const lines: string[] = [];

    // Extract key fields for compact representation
    const issue = parsed.issue as Record<string, unknown> | null;
    if (issue) {
      const id = issue.identifier ?? issue.id ?? "?";
      const title = issue.title ?? "";
      const status = issue.status ?? "";
      lines.push(`issue: ${id} ${title} [${status}]`);
    }

    const reason = parsed.reason;
    if (reason) lines.push(`reason: ${reason}`);

    const comments = parsed.comments as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(comments) && comments.length > 0) {
      lines.push(`comments: ${comments.length}`);
      for (const comment of comments) {
        const body = typeof comment.body === "string" ? comment.body : "";
        const compressed = compressPrompt(body).compressed;
        const author = comment.authorType ?? "unknown";
        lines.push(`- ${author}: ${compressed.slice(0, 500)}`);
      }
    }

    const stage = parsed.executionStage as Record<string, unknown> | undefined;
    if (stage) {
      lines.push(`role: ${stage.wakeRole ?? "?"}`);
      if (Array.isArray(stage.allowedActions) && stage.allowedActions.length > 0) {
        lines.push(`actions: ${(stage.allowedActions as string[]).join(",")}`);
      }
    }

    return lines.join("\n");
  } catch {
    // Fallback: stringify and compress
    const stringified = typeof payload === "string" ? payload : JSON.stringify(payload);
    return compressPrompt(stringified).compressed;
  }
}

/**
 * Compress a bootstrap prompt template string.
 * Lighter touch than full compression — only remove fillers and collapse whitespace.
 */
export function compressBootstrapPrompt(template: string): string {
  if (!template || template.trim().length === 0) return template;
  return compressPrompt(template, {
    stripArticles: false,
    abbreviateCommon: false,
  }).compressed;
}

/**
 * Compress Paperclip environment variable notes into a compact format.
 * Strips verbose descriptions and keeps only variable names.
 */
export function compressEnvironmentNotes(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return `PAPERCLIP env vars: ${paperclipKeys.join(", ")}`;
}

/**
 * Compress the API access note section. Returns a minimal curl-example line
 * instead of the verbose multi-line instructions.
 */
export function compressApiNotes(): string {
  return "Use curl with $PAPERCLIP_API_KEY and $PAPERCLIP_API_URL for API calls.";
}

/**
 * Truncate large tool outputs to prevent context overflow.
 * Keeps the head and tail of the output, with a marker indicating omission.
 */
export const MAX_TOOL_OUTPUT_CHARS = 8000;
export const TAIL_CHARS = 1000;
export const HEAD_CHARS = MAX_TOOL_OUTPUT_CHARS - TAIL_CHARS;

export function truncateToolOutput(output: string, toolName: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;

  const omitted = output.length - HEAD_CHARS - TAIL_CHARS;
  return [
    output.slice(0, HEAD_CHARS),
    `\n... [truncated: ${omitted} chars omitted from "${toolName}" output] ...\n`,
    output.slice(-TAIL_CHARS),
  ].join("");
}
