import type { ClientTool, Confirm } from "../engine/types";
import type { UserMemory } from "./store";

/**
 * Memory tools offered to the model. A fresh set is built for every session,
 * so per-session limits (one proposal per conversation) reset on /new.
 */
export function memoryTools(opts: {
  mem: UserMemory;
  /** Asks the user a yes/no question in the UI; resolves true on yes. */
  confirm: Confirm;
}): ClientTool[] {
  const { mem, confirm } = opts;
  let proposed = false;

  const replacesSchema = {
    type: ["string", "null"],
    description: "Id of an existing preference this one replaces (e.g. p-1a2b), or null.",
  };

  const tools: ClientTool[] = [
    {
      name: "remember",
      description:
        "Save a lasting preference for this user. Only call when the user explicitly asks you to remember something.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The preference, one short sentence." },
          replaces: replacesSchema,
        },
        required: ["text", "replaces"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const { text, replaces } = args as { text: string; replaces: string | null };
        try {
          const p = mem.addPreference(text, "explicit", replaces);
          return { success: true, text: `Saved as ${p.id}.`, display: `memory saved [${p.id}]: ${p.text}` };
        } catch (e) {
          return { success: false, text: `Not saved: ${(e as Error).message}.` };
        }
      },
    },
    {
      name: "propose_memory",
      description:
        "Ask the user whether to save a lasting preference they stated without asking you to remember it. At most once per conversation.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The preference to save, one short sentence." },
          replaces: replacesSchema,
        },
        required: ["text", "replaces"],
        additionalProperties: false,
      },
      handle: async (args) => {
        const { text, replaces } = args as { text: string; replaces: string | null };
        if (proposed) return { success: false, text: "Already proposed once in this conversation; do not propose again." };
        proposed = true;
        if (!(await confirm({ kind: "memory", title: "Remember this for future conversations?", items: [text] }))) {
          return { success: true, text: "The user declined; nothing was saved. Do not ask again.", display: "not saved" };
        }
        try {
          const p = mem.addPreference(text, "proposed", replaces);
          return { success: true, text: `The user agreed. Saved as ${p.id}.`, display: `memory saved [${p.id}]: ${p.text}` };
        } catch (e) {
          return { success: false, text: `Not saved: ${(e as Error).message}.` };
        }
      },
    },
  ];

  return tools;
}
