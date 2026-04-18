import { describe, expect, it } from "vitest";
import {
  compressPrompt,
  compressInstructions,
  compressWakeContext,
  compressBootstrapPrompt,
  compressEnvironmentNotes,
  compressApiNotes,
} from "../compression.js";

describe("compression", () => {
  describe("compressPrompt", () => {
    it("should return original for empty input", () => {
      const result = compressPrompt("");
      expect(result.compressed).toBe("");
      expect(result.reductionPercent).toBe(0);
    });

    it("should return original for whitespace-only input", () => {
      const result = compressPrompt("   \n\n  ");
      expect(result.reductionPercent).toBe(0);
    });

    it("should strip filler phrases", () => {
      const input = "I'd be happy to help you with that. Let me explain the solution.";
      const result = compressPrompt(input);
      expect(result.compressed).not.toContain("I'd be happy to");
      expect(result.compressed).not.toContain("Let me");
      expect(result.reductionPercent).toBeGreaterThan(0);
    });

    it("should strip articles from prose", () => {
      const input = "Create a file in the directory.";
      const result = compressPrompt(input);
      expect(result.compressed).not.toMatch(/\ba\b/i);
      expect(result.compressed).not.toMatch(/\bthe\b/i);
    });

    it("should abbreviate common words", () => {
      const input = "The implementation uses the configuration from the environment.";
      const result = compressPrompt(input);
      expect(result.compressed).toContain("impl");
      expect(result.compressed).toContain("config");
      expect(result.compressed).toContain("env");
    });

    it("should preserve code blocks verbatim", () => {
      const codeBlock = "```python\ndef hello():\n    print('Hello, world!')\n```";
      const input = `I'd be happy to help. Here is the code:\n\n${codeBlock}\n\nThat should work.`;
      const result = compressPrompt(input);
      expect(result.compressed).toContain(codeBlock);
    });

    it("should preserve inline code", () => {
      const input = "The function `calculateTotal()` should be called first.";
      const result = compressPrompt(input);
      expect(result.compressed).toContain("`calculateTotal()`");
    });

    it("should preserve negations", () => {
      const input = "The value cannot be null. Don't remove it.";
      const result = compressPrompt(input);
      expect(result.compressed).toContain("cannot");
      expect(result.compressed).toContain("Don't");
    });

    it("should collapse whitespace", () => {
      const input = "Too   many    spaces   here.";
      const result = compressPrompt(input);
      expect(result.compressed).not.toContain("   ");
    });

    it("should achieve meaningful reduction on realistic input", () => {
      const input = `
I'd be happy to help you with your implementation. Let me explain the approach.

The reason is that when you create a new configuration for the environment, you need to
ensure that the implementation follows the specification. As you can see, the function
handles the authentication and authorization logic. Note that the parameters should
include the application name and the repository reference.

Here is the code:

\`\`\`typescript
function validateConfig(config: Record<string, unknown>) {
  if (!config.database) throw new Error("Missing database configuration");
  return true;
}
\`\`\`

In summary, the implementation should work as expected.
      `.trim();
      const result = compressPrompt(input);
      expect(result.reductionPercent).toBeGreaterThan(20);
      // Code block preserved
      expect(result.compressed).toContain("function validateConfig");
      expect(result.compressed).toContain("Missing database configuration");
    });

    it("should handle very short input gracefully", () => {
      const result = compressPrompt("OK");
      expect(result.compressed).toBe("OK");
    });

    it("should respect options to disable specific compressions", () => {
      const input = "The implementation uses a configuration.";
      const result = compressPrompt(input, {
        abbreviateCommon: false,
        stripArticles: false,
      });
      expect(result.compressed).toContain("implementation");
      expect(result.compressed).toContain("The");
    });

    it("should preserve JSON blobs", () => {
      const json = '{"key": "value", "count": 42}';
      const input = `Here is the configuration: ${json}`;
      const result = compressPrompt(input, { preserveJson: true });
      // JSON should be preserved (or at least not have articles stripped from it)
      expect(result.compressed).toContain("key");
      expect(result.compressed).toContain("value");
    });
  });

  describe("compressInstructions", () => {
    it("should compress agent instructions", () => {
      const instructions = `
You are an AI assistant. I'd be happy to help you understand the system.
The implementation uses the following configuration for the environment.
Note that the application should not modify the database directly.
      `.trim();
      const result = compressInstructions(instructions);
      expect(result.length).toBeLessThan(instructions.length);
      // Critical negation preserved
      expect(result).toContain("not");
    });

    it("should return empty for empty input", () => {
      expect(compressInstructions("")).toBe("");
      expect(compressInstructions("  ")).toBe("  ");
    });
  });

  describe("compressWakeContext", () => {
    it("should return empty for null/undefined", () => {
      expect(compressWakeContext(null)).toBe("");
      expect(compressWakeContext(undefined)).toBe("");
    });

    it("should compress string payloads", () => {
      const input = "I'd be happy to help. The issue is about the implementation.";
      const result = compressWakeContext(input);
      expect(result.length).toBeLessThanOrEqual(input.length);
    });

    it("should produce compact representation for structured payloads", () => {
      const payload = {
        reason: "new_comment",
        issue: { id: "123", identifier: "PC-42", title: "Fix bug", status: "open" },
        comments: [
          { body: "Please fix this issue as soon as possible.", authorType: "user" },
        ],
        executionStage: { wakeRole: "executor", allowedActions: ["approve", "reject"] },
      };
      const result = compressWakeContext(payload);
      expect(result).toContain("PC-42");
      expect(result).toContain("Fix bug");
      expect(result).toContain("new_comment");
    });
  });

  describe("compressBootstrapPrompt", () => {
    it("should strip fillers but preserve structure", () => {
      const template = "I'd be happy to help. You are agent {{agent.id}}.";
      const result = compressBootstrapPrompt(template);
      expect(result).not.toContain("I'd be happy to");
      expect(result).toContain("{{agent.id}}");
    });

    it("should return empty for empty input", () => {
      expect(compressBootstrapPrompt("")).toBe("");
    });
  });

  describe("compressEnvironmentNotes", () => {
    it("should produce compact env var list", () => {
      const env = {
        PAPERCLIP_AGENT_ID: "agent-1",
        PAPERCLIP_API_URL: "http://localhost:3100",
        HOME: "/home/user",
      };
      const result = compressEnvironmentNotes(env);
      expect(result).toContain("PAPERCLIP_AGENT_ID");
      expect(result).toContain("PAPERCLIP_API_URL");
      expect(result).not.toContain("HOME");
      expect(result.length).toBeLessThan(200);
    });

    it("should return empty when no PAPERCLIP_ vars", () => {
      expect(compressEnvironmentNotes({ HOME: "/home/user" })).toBe("");
    });
  });

  describe("compressApiNotes", () => {
    it("should return a compact string", () => {
      const result = compressApiNotes();
      expect(result.length).toBeLessThan(100);
      expect(result).toContain("curl");
    });
  });

  describe("large input compression benchmark", () => {
    it("should achieve significant reduction on large prompt-like input", () => {
      // Simulate a ~5KB prompt with verbose prose sections
      const section = `
I'd be happy to help you with this task. Let me explain the approach.

The implementation should follow the specification carefully. As you can see,
the configuration requires setting up the environment variables properly.
Note that the application architecture uses a microservices pattern.

The reason is that we need to ensure the authentication and authorization
mechanisms are properly configured. In order to do this, you should check
the documentation and reference the implementation guide.

Please note that the function parameters should include the repository URL
and the database connection string. The temporary directory should be cleaned
up after the operation completes.
      `.trim();

      // Repeat to simulate realistic prompt size
      const largeInput = Array(10).fill(section).join("\n\n");
      const result = compressPrompt(largeInput);

      expect(result.originalLength).toBeGreaterThan(3000);
      expect(result.reductionPercent).toBeGreaterThan(25);
    });
  });
});
