// ---------------------------------------------------------------------------
// Session Storage — persist conversation context across heartbeats.
// Provides in-memory (dev/testing) and file-based (production) stores.
// ---------------------------------------------------------------------------

import type { ConversationContext, ConversationTurn } from "./conversation-history.js";
import { buildConversationContext } from "./conversation-history.js";

// ---------------------------------------------------------------------------
// Session store interface
// ---------------------------------------------------------------------------

export interface SessionStore {
  saveSession(id: string, context: ConversationContext): Promise<void>;
  loadSession(id: string): Promise<ConversationContext | null>;
  appendTurn(id: string, turn: ConversationTurn): Promise<void>;
  clearSession(id: string): Promise<void>;
  /** List all session IDs. */
  listSessions(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// In-memory session store (dev/testing only — lost on restart)
// ---------------------------------------------------------------------------

interface InMemoryEntry {
  context: ConversationContext;
  updatedAt: number;
}

/**
 * Create a simple in-memory session store backed by a Map.
 * Suitable for development and testing only.
 */
export function createInMemorySessionStore(): SessionStore {
  const store = new Map<string, InMemoryEntry>();

  return {
    async saveSession(id: string, context: ConversationContext): Promise<void> {
      store.set(id, { context, updatedAt: Date.now() });
    },

    async loadSession(id: string): Promise<ConversationContext | null> {
      const entry = store.get(id);
      return entry?.context ?? null;
    },

    async appendTurn(id: string, turn: ConversationTurn): Promise<void> {
      const entry = store.get(id);
      if (!entry) {
        // Create a new context with sensible defaults
        const context = buildConversationContext(id, [turn], 128_000);
        store.set(id, { context, updatedAt: Date.now() });
        return;
      }
      const allTurns = [...entry.context.turns, turn];
      const updated = buildConversationContext(
        entry.context.sessionId,
        allTurns,
        entry.context.contextLimit,
      );
      store.set(id, { context: updated, updatedAt: Date.now() });
    },

    async clearSession(id: string): Promise<void> {
      store.delete(id);
    },

    async listSessions(): Promise<string[]> {
      return [...store.keys()];
    },
  };
}

// ---------------------------------------------------------------------------
// File-based JSON session store (lightweight persistence)
// ---------------------------------------------------------------------------

interface FileSessionData {
  sessionId: string;
  turns: ConversationTurn[];
  contextLimit: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Create a file-based session store that persists to a directory.
 * Each session is stored as a JSON file.
 *
 * @param storageDir - Absolute path to the storage directory
 */
export function createFileSessionStore(storageDir: string): SessionStore {
  // Lazy import to avoid pulling fs into browser builds
  const getFs = async () => {
    const { promises: fs } = await import("node:fs");
    return fs;
  };
  const getPath = async () => import("node:path");

  const sessionFilePath = async (id: string) => {
    const pathMod = await getPath();
    // Sanitize id to be filesystem-safe
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return pathMod.default.join(storageDir, `session_${safeId}.json`);
  };

  const ensureDir = async () => {
    const fs = await getFs();
    await fs.mkdir(storageDir, { recursive: true });
  };

  return {
    async saveSession(id: string, context: ConversationContext): Promise<void> {
      await ensureDir();
      const fs = await getFs();
      const filePath = await sessionFilePath(id);
      const data: FileSessionData = {
        sessionId: context.sessionId,
        turns: context.turns,
        contextLimit: context.contextLimit,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    },

    async loadSession(id: string): Promise<ConversationContext | null> {
      try {
        const fs = await getFs();
        const filePath = await sessionFilePath(id);
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as FileSessionData;
        return buildConversationContext(data.sessionId, data.turns, data.contextLimit);
      } catch {
        return null;
      }
    },

    async appendTurn(id: string, turn: ConversationTurn): Promise<void> {
      const existing = await this.loadSession(id);
      if (!existing) {
        const context = buildConversationContext(id, [turn], 128_000);
        await this.saveSession(id, context);
        return;
      }
      const allTurns = [...existing.turns, turn];
      const updated = buildConversationContext(existing.sessionId, allTurns, existing.contextLimit);
      await this.saveSession(id, updated);
    },

    async clearSession(id: string): Promise<void> {
      try {
        const fs = await getFs();
        const filePath = await sessionFilePath(id);
        await fs.unlink(filePath);
      } catch {
        // Ignore if file doesn't exist
      }
    },

    async listSessions(): Promise<string[]> {
      try {
        const fs = await getFs();
        await ensureDir();
        const files = await fs.readdir(storageDir);
        return files
          .filter((f) => f.startsWith("session_") && f.endsWith(".json"))
          .map((f) => f.replace(/^session_/, "").replace(/\.json$/, ""));
      } catch {
        return [];
      }
    },
  };
}
