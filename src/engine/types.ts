/**
 * Engine-agnostic contract. The CLI (and later a voice front end) only talks
 * to this interface, so the backend can be swapped (app-server, Responses API, ...).
 */

export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "text_done"; text: string }
  /** `files`: absolute paths of files the tool saved (a UI can offer to open them). */
  | { type: "tool_activity"; summary: string; files?: string[] }
  | { type: "skill_loaded"; name: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedInputTokens: number }
  | { type: "error"; message: string; willRetry: boolean }
  /** URLs in the reply that no tool returned in this conversation (possible hallucination). */
  | { type: "unverified_links"; urls: string[] }
  | { type: "turn_end"; status: "completed" | "interrupted" | "failed"; error?: string };

export interface SessionInfo {
  threadId: string;
  model: string;
  reasoningEffort: string | null;
  serviceTier: string | null;
  sandbox: string;
  approvalPolicy: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface AccountStatus {
  loggedIn: boolean;
  description: string;
}

/**
 * A tool implemented by the client and offered to the model. The engine routes
 * the model's calls to `handle`; nothing else the model asks for is executed.
 */
export interface ClientTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  inputSchema: object;
  handle(args: unknown): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  success: boolean;
  /** What the model sees. */
  text: string;
  /** Optional one-line note shown to the user (e.g. "memory saved"). */
  display?: string;
  /** Absolute paths of files the tool saved, if any. */
  files?: string[];
}

/**
 * A yes/no question a tool (or the app) needs the user to answer before it acts,
 * e.g. saving to the business profile. Structured so a UI can show a dialog;
 * confirmText() renders it for a terminal.
 */
export interface ConfirmRequest {
  kind: "profile" | "register" | "memory" | "folder-import" | "criteria" | "setup";
  /** The question, e.g. "Save to the business profile?" */
  title: string;
  /** What would change, one line each. */
  items?: string[];
  /** Cannot be undone (e.g. deleting an employee). */
  destructive?: boolean;
}

export type Confirm = (req: ConfirmRequest) => Promise<boolean>;

export const confirmText = (r: ConfirmRequest) => [r.title, ...(r.items ?? []).map((i) => `  ${i}`)].join("\n");

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface WebSearchRecord {
  /** "search" | "openPage" | "findInPage" | "other" */
  action: string;
  query: string;
  /** Page URL for openPage/findInPage. */
  url: string | null;
  /** Domains of the results the tool returned. */
  resultDomains: string[];
}

export interface EphemeralResult {
  text: string;
  webSearches: WebSearchRecord[];
}

export interface StoredSession {
  threadId: string;
  preview: string;
  updatedAt: Date;
}

export interface Engine {
  start(): Promise<void>;
  account(): Promise<AccountStatus>;
  /** Interactive login; `onPrompt` shows the user what to do (URL + code). */
  login(onPrompt: (message: string) => void): Promise<void>;
  /** Starts a new conversation with freshly built instructions. */
  newSession(): Promise<SessionInfo>;
  /**
   * Reopens a stored conversation. The server keeps its original instructions,
   * so `contextUpdate` (if given) is prepended to the next user message.
   */
  resumeSession(threadId: string, contextUpdate?: string): Promise<SessionInfo>;
  /** Allowlisted skills the model (load_skill) and the user (explicit) can use. */
  listSkills(): SkillInfo[];
  /** Streams events for one user turn. `skill` explicitly attaches an allowlisted skill; `images` are local image paths the user attached. */
  send(text: string, opts?: { skill?: string; images?: string[] }): AsyncIterable<EngineEvent>;
  /** True while a turn is running. */
  isBusy(): boolean;
  /**
   * Adds a user message to the running turn (turn/steer). Returns false if no
   * turn is running, in which case the caller should send() instead.
   */
  steer(text: string): Promise<boolean>;
  /** User/assistant messages of the current session since it was started or resumed. */
  transcript(): TranscriptEntry[];
  /**
   * One-off request in a throwaway conversation that is never written to disk,
   * sees nothing from the user's conversation, and has no client tools. Used for
   * background jobs (session summaries) and isolated web research. `config`
   * overrides CODEX_HOME settings for this thread only (e.g. enable web search).
   */
  runEphemeral(
    prompt: string,
    opts: { instructions: string; outputSchema?: object; config?: Record<string, unknown> },
  ): Promise<EphemeralResult>;
  /** All stored conversations (every user), for retention cleanup. */
  listStoredSessions(): Promise<StoredSession[]>;
  deleteStoredSession(threadId: string): Promise<void>;
  /** Switches service tier for the current session (from the next turn) and for new sessions. */
  setServiceTier(tier: string): void;
  /** Stops the in-flight turn, if any. */
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
