import type { UserMemory } from "./store";

/** Recent work notes included per session; older ones stay stored until they expire. */
export const MAX_TASKS_IN_CONTEXT = 5;

/**
 * The memory part of the developer instructions for a new session: the memory
 * rules, then this user's preferences and recent work notes. Ids are shown so
 * the model can pass `replaces`. (Business facts come from the business
 * profile and policies, see src/business/.)
 */
export function buildMemoryContext(mem: UserMemory, rules: string): string {
  return [rules.trim(), userSection(mem)].join("\n\n");
}

/** The per-user part alone; also sent as a context update when a stored conversation is resumed. */
export function userSection(mem: UserMemory): string {
  const prefs = mem.preferences();
  const tasks = mem.tasks().slice(0, MAX_TASKS_IN_CONTEXT);
  const lines = [`# About this user (user id: ${mem.userId})`, "", "Preferences:"];
  lines.push(...(prefs.length ? prefs.map((p) => `- [${p.id}] ${p.text}`) : ["- (none yet)"]));
  lines.push("", "Recent work notes (from earlier conversations; may be out of date):");
  lines.push(...(tasks.length ? tasks.map((t) => `- [${t.id}] ${t.createdAt.slice(0, 10)}: ${t.text}`) : ["- (none)"]));
  return lines.join("\n");
}
