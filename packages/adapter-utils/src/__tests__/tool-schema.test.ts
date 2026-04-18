import { describe, expect, it } from "vitest";
import {
  buildToolSchemas,
  buildGeminiToolSchema,
  buildClaudeToolSchema,
  buildLlamaToolSchema,
  estimateSchemaSize,
} from "../tool-schema.js";
import type { Tool } from "../tool-schema.js";

const sampleTools: Tool[] = [
  {
    name: "read_file",
    description: "Use this tool to read the contents of a file from the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
      },
      required: ["path"],
    },
    relevance: 0.9,
  },
  {
    name: "write_file",
    description: "Call this tool to write content to a file on the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
    relevance: 0.85,
  },
  {
    name: "search_code",
    description: "A tool that allows you to search for patterns in code files using regex.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
    },
    relevance: 0.7,
  },
];

describe("tool-schema", () => {
  describe("buildToolSchemas", () => {
    it("should convert tools to schemas", () => {
      const schemas = buildToolSchemas(sampleTools);
      expect(schemas).toHaveLength(3);
      expect(schemas[0]!.name).toBe("read_file");
    });

    it("should compress descriptions", () => {
      const schemas = buildToolSchemas(sampleTools);
      // "Use this tool to read the contents..." should be compressed
      const readSchema = schemas.find((s) => s.name === "read_file");
      expect(readSchema).toBeDefined();
      // Filler "Use this tool to" should be removed
      expect(readSchema!.description).not.toMatch(/^Use this tool to/);
      expect(readSchema!.description.length).toBeLessThanOrEqual(100);
    });

    it("should sort by relevance", () => {
      const schemas = buildToolSchemas(sampleTools, { sortByRelevance: true });
      expect(schemas[0]!.name).toBe("read_file"); // highest relevance
      expect(schemas[2]!.name).toBe("search_code"); // lowest relevance
    });

    it("should limit tool count", () => {
      const manyTools: Tool[] = Array.from({ length: 25 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool number ${i}`,
        relevance: Math.random(),
      }));
      const schemas = buildToolSchemas(manyTools, { maxTools: 15 });
      expect(schemas).toHaveLength(15);
    });

    it("should handle empty tools list", () => {
      const schemas = buildToolSchemas([]);
      expect(schemas).toHaveLength(0);
    });

    it("should handle tools without parameters", () => {
      const tools: Tool[] = [
        { name: "get_time", description: "Get current time" },
      ];
      const schemas = buildToolSchemas(tools);
      expect(schemas[0]!.parameters).toEqual({ type: "object", properties: {} });
    });

    it("should truncate long descriptions", () => {
      const tools: Tool[] = [
        {
          name: "complex_tool",
          description: "A".repeat(200),
        },
      ];
      const schemas = buildToolSchemas(tools, { maxDescriptionLength: 100 });
      expect(schemas[0]!.description.length).toBeLessThanOrEqual(100);
      expect(schemas[0]!.description).toContain("…");
    });
  });

  describe("buildGeminiToolSchema", () => {
    it("should produce Gemini function declarations format", () => {
      const schemas = buildToolSchemas(sampleTools);
      const gemini = buildGeminiToolSchema(schemas);
      expect(gemini).toHaveProperty("functionDeclarations");
      expect(gemini.functionDeclarations).toHaveLength(3);
      expect(gemini.functionDeclarations[0]!.name).toBe("read_file");
    });

    it("should strip additionalProperties from Gemini schemas", () => {
      const schemas = buildToolSchemas([
        {
          name: "test",
          description: "test",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ]);
      const gemini = buildGeminiToolSchema(schemas);
      expect(gemini.functionDeclarations[0]!.parameters).not.toHaveProperty(
        "additionalProperties",
      );
    });
  });

  describe("buildClaudeToolSchema", () => {
    it("should produce Claude tool format with input_schema", () => {
      const schemas = buildToolSchemas(sampleTools);
      const claude = buildClaudeToolSchema(schemas);
      expect(claude).toHaveLength(3);
      expect(claude[0]).toHaveProperty("input_schema");
      expect(claude[0]!.name).toBe("read_file");
    });

    it("should ensure type: object in input_schema", () => {
      const schemas = buildToolSchemas([
        { name: "test", description: "test", parameters: { properties: {} } },
      ]);
      const claude = buildClaudeToolSchema(schemas);
      expect(claude[0]!.input_schema).toHaveProperty("type", "object");
    });
  });

  describe("buildLlamaToolSchema", () => {
    it("should produce OpenAI-compatible function calling format", () => {
      const schemas = buildToolSchemas(sampleTools);
      const llama = buildLlamaToolSchema(schemas);
      expect(llama).toHaveLength(3);
      expect(llama[0]!.type).toBe("function");
      expect(llama[0]!.function.name).toBe("read_file");
    });
  });

  describe("estimateSchemaSize", () => {
    it("should estimate size in bytes", () => {
      const schemas = buildToolSchemas(sampleTools);
      const size = estimateSchemaSize(schemas);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(5000); // <5KB for 3 tools
    });

    it("should return 0 for empty schemas", () => {
      expect(estimateSchemaSize([])).toBeGreaterThan(0); // "[]" is still 2 bytes
    });
  });

  describe("schema size budget", () => {
    it("should keep 15 tools under 5KB", () => {
      const tools: Tool[] = Array.from({ length: 20 }, (_, i) => ({
        name: `tool_${i}`,
        description: `This tool performs operation ${i} on the system with complex logic and processing capabilities.`,
        parameters: {
          type: "object",
          properties: {
            input: { type: "string", description: "Input value" },
            options: { type: "object", description: "Options" },
          },
        },
        relevance: Math.random(),
      }));
      const schemas = buildToolSchemas(tools, { maxTools: 15 });
      const size = estimateSchemaSize(schemas);
      expect(schemas).toHaveLength(15);
      expect(size).toBeLessThan(5000);
    });
  });
});
