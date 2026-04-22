/**
 * Dirac conversation persistence — one conversation per project, plus
 * an ephemeral fallback for work outside a project.
 *
 * Storage locations:
 *   Desktop with project → <projectRoot>/.nuclei/dirac.json
 *   Desktop without project → (app-provided) dirac-ephemeral key (via platform store)
 *   Web (always) → localStorage["nuclei:dirac:ephemeral"]
 *
 * This module is intentionally low-level: schema, (de)serialization, and
 * file IO. The Zustand subscribe listener in diracStore owns the WHEN and
 * HOW OFTEN of writes; this module owns WHERE and WHAT FORMAT.
 *
 * Persistence is best-effort. Every exported function catches errors and
 * returns null/false rather than throwing — the in-memory conversation
 * must never be interrupted by a disk issue.
 */

import { loadBridge } from '../platform/PlatformProvider';
import type { DiracMessage, ToolCall } from '../stores/diracStore';

export const CONVERSATION_SCHEMA_VERSION = 1;

// Soft warning thresholds — logged to console when exceeded. No hard cap.
export const SOFT_MESSAGE_LIMIT = 200;
export const SOFT_SIZE_LIMIT_BYTES = 500_000;

const EPHEMERAL_LOCALSTORAGE_KEY = 'nuclei:dirac:ephemeral';
const EPHEMERAL_PLATFORM_KEY = 'dirac_ephemeral_conversation';

const NUCLEI_DIR = '.nuclei';
const CONVERSATION_FILENAME = 'dirac.json';
const GITIGNORE_CONTENT = '*\n!.gitignore\n';

export interface PersistedConversation {
  version: number;
  conversation_id: string;
  created_at: string;
  updated_at: string;
  messages: DiracMessage[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newConversation(): PersistedConversation {
  return {
    version: CONVERSATION_SCHEMA_VERSION,
    conversation_id: crypto.randomUUID(),
    created_at: nowIso(),
    updated_at: nowIso(),
    messages: [],
  };
}

/**
 * Build a PersistedConversation from the current store state. Caller owns
 * conversation_id and created_at (held in the Zustand store); this just
 * stamps updated_at and packages the shape.
 */
export function buildConversation(
  messages: DiracMessage[],
  meta: { conversationId: string; createdAt: string },
): PersistedConversation {
  return {
    version: CONVERSATION_SCHEMA_VERSION,
    conversation_id: meta.conversationId,
    created_at: meta.createdAt,
    updated_at: nowIso(),
    messages,
  };
}

/**
 * Validate and sanitize a loaded conversation payload. Returns null if the
 * version is unknown (forward-compat: future writers must bump the version
 * if they change shape). Demotes any `pending` tool calls to `rejected`
 * since we never resume mid-tool on reload.
 */
export function parseConversation(raw: unknown): PersistedConversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== CONVERSATION_SCHEMA_VERSION) {
    console.warn(
      `[Dirac] Ignoring conversation with unknown schema version: ${data.version}. ` +
        `Supported: ${CONVERSATION_SCHEMA_VERSION}.`,
    );
    return null;
  }
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages: DiracMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as Record<string, unknown>;
    if (mm.role !== 'user' && mm.role !== 'assistant') continue;
    const message: DiracMessage = {
      id: typeof mm.id === 'string' ? mm.id : crypto.randomUUID(),
      role: mm.role,
      content: typeof mm.content === 'string' ? mm.content : '',
      timestamp: typeof mm.timestamp === 'string' ? mm.timestamp : nowIso(),
    };
    if (typeof mm.thinking === 'string') message.thinking = mm.thinking;
    if (Array.isArray(mm.toolCalls)) {
      message.toolCalls = (mm.toolCalls as unknown[])
        .map(sanitizeToolCall)
        .filter((tc): tc is ToolCall => tc !== null);
    }
    messages.push(message);
  }
  return {
    version: CONVERSATION_SCHEMA_VERSION,
    conversation_id:
      typeof data.conversation_id === 'string'
        ? data.conversation_id
        : crypto.randomUUID(),
    created_at: typeof data.created_at === 'string' ? data.created_at : nowIso(),
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : nowIso(),
    messages,
  };
}

function sanitizeToolCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const rr = raw as Record<string, unknown>;
  if (typeof rr.id !== 'string' || typeof rr.name !== 'string') return null;
  const input =
    rr.input && typeof rr.input === 'object'
      ? (rr.input as Record<string, unknown>)
      : {};
  // Any status other than accepted / rejected / executed is demoted to
  // rejected with a standard explanation. A mid-stream crash could leave
  // `pending` in the file; we don't resume — the user re-asks if needed.
  let status: ToolCall['status'];
  let result: string | undefined;
  switch (rr.status) {
    case 'accepted':
    case 'rejected':
    case 'executed':
      status = rr.status;
      result = typeof rr.result === 'string' ? rr.result : undefined;
      break;
    case 'pending':
    default:
      status = 'rejected';
      result = 'Interrupted — please re-ask Dirac if needed.';
      break;
  }
  const tc: ToolCall = { id: rr.id, name: rr.name, input, status };
  if (result !== undefined) tc.result = result;
  return tc;
}

// ──────────────────────────── desktop paths ────────────────────────────

function joinPath(...parts: string[]): string {
  // Desktop only — platform separator is '/' on macOS/Linux and works on
  // Windows too via Tauri's fs APIs. Avoid '\\' to keep this portable.
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}

export function conversationPath(projectRoot: string): string {
  return joinPath(projectRoot, NUCLEI_DIR, CONVERSATION_FILENAME);
}

export function nucleiDirPath(projectRoot: string): string {
  return joinPath(projectRoot, NUCLEI_DIR);
}

export function nucleiGitignorePath(projectRoot: string): string {
  return joinPath(projectRoot, NUCLEI_DIR, '.gitignore');
}

// ──────────────────────────── read ────────────────────────────

export async function readConversation(
  projectRoot: string | null,
): Promise<PersistedConversation | null> {
  try {
    const bridge = await loadBridge();
    const platform = bridge.getPlatform();

    if (projectRoot && platform === 'desktop') {
      const text = await bridge.readFile(conversationPath(projectRoot));
      if (text === null) return null;
      return parseConversation(JSON.parse(text));
    }

    // Ephemeral path.
    if (platform === 'web') {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(EPHEMERAL_LOCALSTORAGE_KEY);
      if (!raw) return null;
      return parseConversation(JSON.parse(raw));
    }

    // Desktop ephemeral — Tauri key-value store handles atomic writes.
    const stored = await bridge.getStoredValue<PersistedConversation>(
      EPHEMERAL_PLATFORM_KEY,
    );
    if (!stored) return null;
    return parseConversation(stored);
  } catch (err) {
    console.warn('[Dirac] readConversation failed:', err);
    return null;
  }
}

// ──────────────────────────── write ────────────────────────────

export async function writeConversation(
  projectRoot: string | null,
  conversation: PersistedConversation,
): Promise<boolean> {
  // Soft warnings: non-blocking, developer-facing. Never surfaced in UI.
  if (conversation.messages.length > SOFT_MESSAGE_LIMIT) {
    console.warn(
      `[Dirac] Conversation has ${conversation.messages.length} messages ` +
        `(soft limit: ${SOFT_MESSAGE_LIMIT}). A future PRD will handle trimming.`,
    );
  }

  try {
    const bridge = await loadBridge();
    const platform = bridge.getPlatform();
    const serialized = JSON.stringify(conversation, null, 2);

    if (serialized.length > SOFT_SIZE_LIMIT_BYTES) {
      console.warn(
        `[Dirac] Conversation is ${Math.round(serialized.length / 1024)} KB ` +
          `on disk (soft limit: ${Math.round(SOFT_SIZE_LIMIT_BYTES / 1024)} KB).`,
      );
    }

    if (projectRoot && platform === 'desktop') {
      const ready = await ensureNucleiDir(projectRoot);
      if (!ready) return false;
      await bridge.saveFile(conversationPath(projectRoot), serialized);
      return true;
    }

    if (platform === 'web') {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(EPHEMERAL_LOCALSTORAGE_KEY, serialized);
      return true;
    }

    await bridge.setStoredValue(EPHEMERAL_PLATFORM_KEY, conversation);
    return true;
  } catch (err) {
    console.warn('[Dirac] writeConversation failed:', err);
    return false;
  }
}

// ──────────────────────────── dir bootstrap ────────────────────────────

/**
 * Ensure `<projectRoot>/.nuclei/` exists and contains a `.gitignore` that
 * excludes AI conversation files from accidental git commits. Idempotent —
 * safe to call on every write.
 *
 * Returns true if the directory is usable after the call.
 */
export async function ensureNucleiDir(projectRoot: string): Promise<boolean> {
  try {
    const bridge = await loadBridge();
    if (bridge.getPlatform() !== 'desktop') return false;

    const dir = nucleiDirPath(projectRoot);
    // Tauri's createDirectory returns null if the dir already exists — that's
    // fine. What matters is that the path is reachable afterwards.
    await bridge.createDirectory(dir, true);

    const gitignorePath = nucleiGitignorePath(projectRoot);
    const existing = await bridge.readFile(gitignorePath);
    if (existing === null) {
      // Write the default gitignore so the conversation file isn't committed
      // by students who habitually `git add .`. If the project has its own
      // top-level .gitignore, we don't touch it — this nested one stands
      // on its own.
      await bridge.saveFile(gitignorePath, GITIGNORE_CONTENT);
    }
    return true;
  } catch (err) {
    console.warn('[Dirac] ensureNucleiDir failed:', err);
    return false;
  }
}

// ──────────────────────────── testing hooks ────────────────────────────

export const __TEST_ONLY__ = {
  EPHEMERAL_LOCALSTORAGE_KEY,
  EPHEMERAL_PLATFORM_KEY,
  GITIGNORE_CONTENT,
};
