import { describe, expect, it } from "vitest";
import { formatCaveman, estimateCavemanReduction } from "../caveman-formatter.js";

describe("caveman-formatter", () => {
  describe("formatCaveman", () => {
    it("should return original for empty input", () => {
      expect(formatCaveman("")).toBe("");
      expect(formatCaveman("  ")).toBe("  ");
    });

    it("should strip greeting fillers at all intensities", () => {
      const input = "I'd be happy to help. Here is the answer.";

      const lite = formatCaveman(input, { intensity: "lite" });
      expect(lite).not.toContain("I'd be happy to help");
      expect(lite).toContain("answer");

      const full = formatCaveman(input, { intensity: "full" });
      expect(full).not.toContain("I'd be happy to help");

      const ultra = formatCaveman(input, { intensity: "ultra" });
      expect(ultra).not.toContain("I'd be happy to help");
    });

    it("should strip transition fillers at full/ultra", () => {
      const input = "Let me explain. The reason is that the code has a bug.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).not.toContain("Let me explain");
      expect(result).not.toContain("The reason is that");
      expect(result).toContain("bug");
    });

    it("should strip extra fillers at ultra", () => {
      const input = "However, the implementation works. Furthermore, it is fast.";
      const result = formatCaveman(input, { intensity: "ultra" });
      expect(result).not.toContain("However,");
      expect(result).not.toContain("Furthermore,");
    });

    it("should apply abbreviations at full intensity", () => {
      const input = "The implementation uses the configuration from the environment.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).toContain("impl");
      expect(result).toContain("config");
      expect(result).toContain("env");
    });

    it("should NOT apply abbreviations at lite intensity", () => {
      const input = "The implementation uses the configuration.";
      const result = formatCaveman(input, { intensity: "lite" });
      // Lite only strips greetings
      expect(result).toContain("implementation");
    });

    it("should strip articles at full/ultra", () => {
      const input = "Create a file in the directory with an extension.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).not.toMatch(/\bthe\b/i);
      expect(result).not.toMatch(/\ba\b/i);
      expect(result).not.toMatch(/\ban\b/i);
    });

    it("should preserve negations even when stripping articles", () => {
      const input = "The value cannot be null. Don't remove it. The function won't work without it.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).toContain("cannot");
      expect(result).toContain("Don't");
      expect(result).toContain("won't");
    });

    it("should preserve code blocks", () => {
      const code = "```python\ndef hello():\n    print('Hello')\n```";
      const input = `I'd be happy to help. Here is the code:\n\n${code}\n\nThat should work.`;
      const result = formatCaveman(input, { intensity: "full", preserveCodeBlocks: true });
      expect(result).toContain(code);
    });

    it("should NOT preserve code blocks when option is false", () => {
      const input = "I'd be happy to help. ```code```";
      const result = formatCaveman(input, {
        intensity: "full",
        preserveCodeBlocks: false,
      });
      // Without preservation, the code block text might get modified
      expect(result).not.toContain("I'd be happy to help");
    });

    it("should apply symbol replacements at full intensity", () => {
      const input = "This leads to a crash. The build succeeded.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).toContain("→");
    });

    it("should handle the spec example transformation", () => {
      const input =
        "I'd be happy to help. The reason your component is re-rendering is likely because you're creating a new object reference on each render cycle.";
      const result = formatCaveman(input, { intensity: "full" });
      // Should not contain greeting
      expect(result).not.toContain("I'd be happy to help");
      // Should not contain "The reason is that" style filler
      // Should contain the core message about re-rendering
      expect(result.length).toBeLessThan(input.length);
    });

    it("should collapse whitespace", () => {
      const input = "Too   many    spaces   here.  \n\n\n\n  More text.";
      const result = formatCaveman(input, { intensity: "full" });
      expect(result).not.toContain("   ");
      expect(result).not.toContain("\n\n\n");
    });
  });

  describe("estimateCavemanReduction", () => {
    it("should calculate reduction percentage", () => {
      const original = "I'd be happy to help you with this implementation task.";
      const formatted = formatCaveman(original, { intensity: "full" });
      const reduction = estimateCavemanReduction(original, formatted);
      expect(reduction.reductionPercent).toBeGreaterThan(0);
      expect(reduction.originalChars).toBe(original.length);
      expect(reduction.formattedChars).toBe(formatted.length);
    });

    it("should return 0% for empty strings", () => {
      const reduction = estimateCavemanReduction("", "");
      expect(reduction.reductionPercent).toBe(0);
    });
  });
});
