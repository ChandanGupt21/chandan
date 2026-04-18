// ---------------------------------------------------------------------------
// Caveman Formatter — compress agent output into terse, information-dense
// text while preserving code blocks, JSON, and critical negations.
// ---------------------------------------------------------------------------

export type CavemanIntensity = "lite" | "full" | "ultra";

export interface CavemanOptions {
  /** Compression intensity level. Default: "full" */
  intensity?: CavemanIntensity;
  /** Preserve fenced code blocks verbatim. Default: true */
  preserveCodeBlocks?: boolean;
  /** Preserve JSON output verbatim. Default: true */
  preserveJsonOutput?: boolean;
}

const DEFAULT_CAVEMAN_OPTIONS: Required<CavemanOptions> = {
  intensity: "full",
  preserveCodeBlocks: true,
  preserveJsonOutput: true,
};

// ---------------------------------------------------------------------------
// Pattern lists
// ---------------------------------------------------------------------------

/** Phrases stripped at all intensity levels */
const GREETING_FILLERS: readonly string[] = [
  "I'd be happy to help",
  "I'd be happy to",
  "I would be happy to help",
  "I would be happy to",
  "I'd love to help",
  "I'd love to",
  "I'm happy to help",
  "I'm glad to help",
  "Sure! I can help with that.",
  "Sure! Let me help.",
  "Sure!",
  "Sure,",
  "Sure thing!",
  "Of course!",
  "Of course,",
  "Absolutely!",
  "Absolutely,",
  "Certainly!",
  "Certainly,",
  "No problem!",
  "No problem,",
  "No worries!",
  "No worries,",
  "You're welcome!",
  "You're welcome,",
  "Happy to help!",
  "Glad to help!",
  "My pleasure!",
  "Great question!",
  "Good question!",
  "That's a great question!",
  "That's a good question!",
  "Excellent question!",
];

/** Transitional fillers removed at full/ultra */
const TRANSITION_FILLERS: readonly string[] = [
  "Let me explain",
  "Let me clarify",
  "Let me break this down",
  "Let me walk you through",
  "Let me help you with that",
  "Let me take a look",
  "Here's what's happening:",
  "Here is what's happening:",
  "Here's what I found:",
  "Here is what I found:",
  "Here's the thing:",
  "Here is the thing:",
  "What's happening is",
  "What's going on is",
  "The reason is that",
  "The reason being",
  "The reason for this is",
  "This is because",
  "As you can see,",
  "As you may know,",
  "As I mentioned,",
  "As mentioned earlier,",
  "As mentioned before,",
  "As noted above,",
  "As we discussed,",
  "It's worth noting that",
  "It is worth noting that",
  "It's important to note that",
  "It is important to note that",
  "It should be noted that",
  "Please note that",
  "Note that",
  "Keep in mind that",
  "Bear in mind that",
  "In other words,",
  "That is to say,",
  "To put it simply,",
  "Simply put,",
  "In essence,",
  "Basically,",
  "Essentially,",
  "Actually,",
  "In fact,",
  "In reality,",
  "When it comes to",
  "In terms of",
  "With respect to",
  "With regard to",
  "In this case,",
  "In any case,",
  "Having said that,",
  "That being said,",
  "With that being said,",
  "With that said,",
  "Moving forward,",
  "Going forward,",
  "To summarize,",
  "In summary,",
  "Long story short,",
  "At the end of the day,",
  "For your reference,",
  "For reference,",
  "For what it's worth,",
  "To be honest,",
  "To be clear,",
  "Just to clarify,",
  "I think that",
  "I believe that",
  "In my opinion,",
  "From what I can tell,",
];

/** Extra verbose phrases stripped at ultra */
const ULTRA_FILLERS: readonly string[] = [
  "However,",
  "Nevertheless,",
  "Furthermore,",
  "Moreover,",
  "Additionally,",
  "In addition,",
  "Consequently,",
  "Therefore,",
  "Thus,",
  "Hence,",
  "Meanwhile,",
  "Subsequently,",
  "Unfortunately,",
  "Fortunately,",
  "Interestingly,",
  "Surprisingly,",
  "Importantly,",
  "Notably,",
  "Specifically,",
  "Particularly,",
  "Typically,",
  "Generally,",
  "Usually,",
  "Normally,",
  "Obviously,",
  "Clearly,",
  "Evidently,",
  "Naturally,",
];

/** Symbol replacements */
const SYMBOL_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ["leads to", "→"],
  ["results in", "→"],
  ["which means", "→"],
  ["causing", "→"],
  ["done", "✓"],
  ["complete", "✓"],
  ["completed", "✓"],
  ["success", "✓"],
  ["succeeded", "✓"],
  ["successful", "✓"],
  ["failed", "✗"],
  ["failure", "✗"],
  ["error", "✗"],
]);

/** Common abbreviations (full/ultra) */
const CAVEMAN_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
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
  ["component", "comp"],
  ["components", "comps"],
  ["directory", "dir"],
  ["directories", "dirs"],
  ["document", "doc"],
  ["documents", "docs"],
  ["documentation", "docs"],
  ["application", "app"],
  ["applications", "apps"],
  ["database", "db"],
  ["information", "info"],
  ["authentication", "auth"],
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
  ["description", "desc"],
  ["operation", "op"],
  ["operations", "ops"],
  ["properties", "props"],
  ["property", "prop"],
]);

/** Articles for removal at full/ultra */
const ARTICLES_RE = /\b(a|an|the)\b/gi;

/** Critical negations — never modify lines containing these */
const NEGATION_RE = /\b(cannot|can't|couldn't|shouldn't|wouldn't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|must not|shall not|may not)\b/i;

// ---------------------------------------------------------------------------
// Segment splitter — protects code blocks and JSON from formatting
// ---------------------------------------------------------------------------

interface Segment {
  text: string;
  isProtected: boolean;
}

function splitSegments(text: string, preserveCode: boolean, preserveJson: boolean): Segment[] {
  if (!preserveCode && !preserveJson) {
    return [{ text, isProtected: false }];
  }

  const segments: Segment[] = [];

  if (preserveCode) {
    // Match fenced code blocks
    const codeBlockRe = /```[\s\S]*?```/g;
    let lastIndex = 0;

    for (const match of text.matchAll(codeBlockRe)) {
      const start = match.index!;
      if (start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, start), isProtected: false });
      }
      segments.push({ text: match[0], isProtected: true });
      lastIndex = start + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), isProtected: false });
    }
  } else {
    segments.push({ text, isProtected: false });
  }

  if (!preserveJson) return segments;

  // Protect JSON blobs in non-protected segments
  const result: Segment[] = [];
  for (const seg of segments) {
    if (seg.isProtected) {
      result.push(seg);
      continue;
    }
    // Simple JSON detection: matching {..} or [..] blocks
    const jsonRe = /(\{[\s\S]*?\}|\[[\s\S]*?\])/g;
    let subLastIndex = 0;
    for (const jMatch of seg.text.matchAll(jsonRe)) {
      const subStart = jMatch.index!;
      const candidate = jMatch[0].trim();
      // Only protect if it actually parses as JSON
      try {
        JSON.parse(candidate);
        if (subStart > subLastIndex) {
          result.push({ text: seg.text.slice(subLastIndex, subStart), isProtected: false });
        }
        result.push({ text: jMatch[0], isProtected: true });
        subLastIndex = subStart + jMatch[0].length;
      } catch {
        // Not valid JSON, leave as prose
      }
    }
    if (subLastIndex < seg.text.length) {
      result.push({ text: seg.text.slice(subLastIndex), isProtected: false });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core formatting logic
// ---------------------------------------------------------------------------

function buildFillerRegex(phrases: readonly string[]): RegExp {
  const escaped = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})\\s*`, "gi");
}

function buildAbbreviationRegex(map: ReadonlyMap<string, string>): RegExp {
  const keys = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${keys.join("|")})\\b`, "gi");
}

function applySymbolReplacements(text: string): string {
  let result = text;
  for (const [phrase, symbol] of SYMBOL_REPLACEMENTS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(re, symbol);
  }
  return result;
}

function formatProse(text: string, intensity: CavemanIntensity): string {
  if (!text.trim()) return text;

  let result = text;

  // Always strip greetings
  const greetingRe = buildFillerRegex(GREETING_FILLERS);
  result = result.replace(greetingRe, "");

  if (intensity === "full" || intensity === "ultra") {
    // Strip transition fillers
    const transitionRe = buildFillerRegex(TRANSITION_FILLERS);
    result = result.replace(transitionRe, "");

    // Apply abbreviations
    const abbrRe = buildAbbreviationRegex(CAVEMAN_ABBREVIATIONS);
    result = result.replace(abbrRe, (match) => {
      const abbr = CAVEMAN_ABBREVIATIONS.get(match.toLowerCase());
      if (!abbr) return match;
      return match[0] === match[0].toUpperCase()
        ? abbr.charAt(0).toUpperCase() + abbr.slice(1)
        : abbr;
    });

    // Strip articles (but not from lines with negations)
    result = result
      .split("\n")
      .map((line) => (NEGATION_RE.test(line) ? line : line.replace(ARTICLES_RE, "")))
      .join("\n");

    // Symbol replacements
    result = applySymbolReplacements(result);
  }

  if (intensity === "ultra") {
    // Strip extra transitional words
    const ultraRe = buildFillerRegex(ULTRA_FILLERS);
    result = result.replace(ultraRe, "");
  }

  // Collapse whitespace
  result = result.replace(/[^\S\n]+/g, " ");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply caveman formatting to agent output text.
 *
 * @example
 * ```
 * formatCaveman(
 *   "I'd be happy to help. The reason your component is re-rendering is likely because you're creating a new object reference on each render cycle.",
 *   { intensity: "full" }
 * )
 * // → "Comp re-renders. New obj ref each render."
 * ```
 */
export function formatCaveman(text: string, options: CavemanOptions = {}): string {
  if (!text || text.trim().length === 0) return text;

  const opts: Required<CavemanOptions> = { ...DEFAULT_CAVEMAN_OPTIONS, ...options };
  const segments = splitSegments(text, opts.preserveCodeBlocks, opts.preserveJsonOutput);

  return segments
    .map((seg) => (seg.isProtected ? seg.text : formatProse(seg.text, opts.intensity)))
    .join("");
}

/**
 * Estimate the token reduction percentage from caveman formatting.
 * Useful for metrics and logging.
 */
export function estimateCavemanReduction(
  original: string,
  formatted: string,
): { reductionPercent: number; originalChars: number; formattedChars: number } {
  return {
    reductionPercent:
      original.length > 0
        ? Math.round(((original.length - formatted.length) / original.length) * 100)
        : 0,
    originalChars: original.length,
    formattedChars: formatted.length,
  };
}
