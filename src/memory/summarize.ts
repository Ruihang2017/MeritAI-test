import type { Engine, TranscriptEntry } from "../engine/types";
import { findPii, type TaskNote, type UserMemory } from "./store";

const MAX_ITEMS = 3;
const MAX_CHARS_PER_MESSAGE = 1500;
const MAX_MESSAGES = 40;

const INSTRUCTIONS = `You extract work-in-progress notes from a conversation between an HR professional and an AI assistant, so the assistant can pick up where they left off next time.

Rules:
- Only record HR work that has a state worth resuming (recruitment, onboarding, reviews, conversations, offboarding): which role or task, what was produced or decided, and the next step. Describe people by role only ("a team leader", "the new Payroll Officer"). Example: "Customer Service Coordinator (Sydney): job ad drafted and approved by the user; next: interview kit."
- At most ${MAX_ITEMS} notes, each one sentence under 200 characters, in the language the user mostly wrote in.
- Never include personal information: no names of candidates, employees or other people, no details of complaints, health, performance or pay about identifiable people, no contact details, ages, personal circumstances or assessments of individuals. Refer to candidates as "Candidate A/B" or "the shortlisted candidates".
- Never include file names (they often contain people's names). Say "the resumes in the inbox" or "the saved screening report" instead.
- Skip small talk, general questions and one-off requests with nothing to resume.
- If an existing note is about the same piece of work, update it by returning its id in "replaces".
- If there is nothing worth resuming, return an empty list.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          replaces: { type: ["string", "null"] },
        },
        required: ["text", "replaces"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function render(transcript: TranscriptEntry[]): string {
  return transcript
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const t = m.text.length > MAX_CHARS_PER_MESSAGE ? m.text.slice(0, MAX_CHARS_PER_MESSAGE) + " [...]" : m.text;
      return `${m.role === "user" ? "USER" : "ASSISTANT"}: ${t}`;
    })
    .join("\n\n");
}

/**
 * End-of-session summary (memory write mechanism 4). Runs in an ephemeral
 * thread; saves at most a few task notes. Returns what was saved.
 */
export async function summarizeSession(engine: Engine, mem: UserMemory): Promise<TaskNote[]> {
  const transcript = engine.transcript();
  if (!transcript.some((m) => m.role === "user")) return [];

  const existing = mem.tasks();
  const prompt =
    `Existing notes:\n${existing.length ? existing.map((t) => `- [${t.id}] ${t.text}`).join("\n") : "- (none)"}\n\n` +
    `Conversation:\n\n${render(transcript)}`;

  const { text: raw } = await engine.runEphemeral(prompt, { instructions: INSTRUCTIONS, outputSchema: SCHEMA });
  let items: { text: string; replaces: string | null }[];
  try {
    items = (JSON.parse(raw) as { items: typeof items }).items ?? [];
  } catch {
    return [];
  }

  const validIds = new Set(existing.map((t) => t.id));
  const saved: TaskNote[] = [];
  for (const it of items.slice(0, MAX_ITEMS)) {
    // Backstop behind the instructions: drop anything that looks like personal data.
    if (findPii(it.text)) continue;
    const note = mem.addTask(it.text, it.replaces && validIds.has(it.replaces) ? it.replaces : null);
    if (note) saved.push(note);
  }
  return saved;
}
