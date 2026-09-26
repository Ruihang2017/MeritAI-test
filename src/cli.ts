// Terminal front end: reads commands, renders data and events. All behaviour lives in
// src/app/app.ts (AssistantApp), so another front end can reuse it unchanged.
import { createInterface } from "node:readline/promises";
import { userInfo } from "node:os";
import { spawn } from "node:child_process";
import { AssistantApp, TIERS, tierLabel, VOICE_IDLE_SECONDS, type AppEvent, type AttachOutcome, type VoiceController } from "./app/app";
import { confirmText, type Confirm } from "./engine/types";
import type { TaskNote } from "./memory/store";
import { employeeLine } from "./business/register";
import { formatReminders, todayLocal } from "./business/reminders";
import { SCREEN_BATCH_LIMIT, SCREEN_CONCURRENCY } from "./screening/pipeline";

const DEBUG = process.env.FX_DEBUG === "1";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const HELP = `Business
  /setup                 set up or update the business profile (a short interview)
  /profile               show the business profile and policy documents
  /staff [all]           list the employee register (all: include people who left); change it in the chat
  /reminders             compliance reminders due in the next 30 days or overdue (also shown at startup)
Conversation
  /new                   start a new conversation (saves notes from this one)
  /history               list your earlier conversations
  /resume <n>            continue conversation number n from /history
Skills
  /skills                list skills
  /<skill> <request>     use a skill explicitly (a unique prefix is enough, e.g. /int)
                         skills are also picked automatically when a request matches
Files (or drag files into this window: they are copied into the Inbox and attached to your message)
  /files                 list your Inbox and show the Jobs/Inbox/Outbox/Policies folders
  /files open            open the folder in Explorer
  /files set <path>      use another business workspace folder (Jobs, Inbox, Outbox, Policies and the profile live inside it)
  /files reset           back to the default folder
Jobs and screening
  /jobs                  list job folders (one per role under Jobs/)
  /import <path> [job]   copy a folder of resumes (and a JD file) into a job; job defaults to the folder name
  /screen <job>          screen the job's resumes: confirm criteria, then up to ${SCREEN_BATCH_LIMIT} new resumes per run, ${SCREEN_CONCURRENCY} in parallel; results in the terminal
  /report <job> [word|excel|both]   save a screening report to the Outbox (Word by default)
                         (or just ask in the chat, e.g. "screen the store_manager applicants")
Memory
  /remember <text>       save a lasting preference
  /memories              show your saved preferences and work notes
  /forget <id>           delete a preference or note (id from /memories)
Voice
  /voice                 talk instead of typing (press Enter or Ctrl+C to stop); headphones recommended
  /voice device [n]      list microphones, or pick number n
Settings
  /tier fast|standard    switch speed tier
  /help  /exit
Ctrl+C while the assistant is replying stops it; Ctrl+C at the prompt quits.`;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** --tier <name> beats FX_TIER; default is fast (priority). */
function initialTier(): string {
  const name = argValue("--tier") ?? process.env.FX_TIER ?? "fast";
  const id = TIERS[name.toLowerCase()];
  if (!id) throw new Error(`unknown tier "${name}" (use fast or standard)`);
  return id;
}

/** POC identity: --user beats the OS user name. Replace with SSO later. */
function resolveUser(): string {
  const raw = argValue("--user") ?? process.env.FX_USER ?? userInfo().username;
  const id = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!id) throw new Error(`invalid user id "${raw}"`);
  return id;
}

/** Renders one assistant turn's events; shared by typed and spoken requests. */
function makePrinter() {
  const started = Date.now();
  let firstTokenMs: number | null = null;
  let streamed = "";
  return (ev: AppEvent) => {
    switch (ev.type) {
      case "text_delta":
        firstTokenMs ??= Date.now() - started;
        streamed += ev.text;
        process.stdout.write(ev.text);
        break;
      case "text_done":
        // Fallback if the server sent a whole message without deltas.
        if (!streamed) process.stdout.write(ev.text);
        streamed = "";
        break;
      case "warning":
        process.stdout.write(yellow(`\n! ${ev.message}`));
        break;
      case "tool_activity":
        process.stdout.write(dim(`[${ev.summary}] `));
        break;
      case "skill_loaded":
        process.stdout.write(dim(`[skill: ${ev.name}] `));
        break;
      case "unverified_links":
        process.stdout.write(yellow(`\n! unverified link(s), not returned by any source in this conversation: ${ev.urls.join(" ")}`));
        break;
      case "error":
        process.stdout.write(red(`\n[error${ev.willRetry ? ", retrying" : ""}] ${ev.message}\n`));
        break;
      case "usage":
        if (DEBUG) process.stdout.write(dim(`\n[tokens in=${ev.inputTokens} cached=${ev.cachedInputTokens} out=${ev.outputTokens}]`));
        break;
      case "turn_end": {
        const total = ((Date.now() - started) / 1000).toFixed(1);
        const ttft = firstTokenMs === null ? "-" : `${(firstTokenMs / 1000).toFixed(1)}s`;
        if (ev.status === "interrupted") process.stdout.write(dim("\n[stopped]"));
        if (ev.status === "failed") process.stdout.write(red(`\n[failed] ${ev.error ?? ""}`));
        process.stdout.write(dim(`\n(${total}s, first token ${ttft})\n\n`));
        break;
      }
    }
  };
}

function printNotes(notes: TaskNote[] | null, error?: string) {
  if (error) return console.log(red(`failed: ${error}`));
  if (notes === null) return;
  console.log(dim(notes.length ? "" : "nothing to save"));
  for (const n of notes) console.log(dim(`  note saved [${n.id}]: ${n.text}`));
}

function printAttachOutcome(o: AttachOutcome) {
  switch (o.kind) {
    case "attached":
      return console.log(dim(`  attached: ${o.name}${o.reused ? " (already in the Inbox)" : " (copied to the Inbox)"}`));
    case "imported":
      return console.log(dim(`  imported into job "${o.job}": ${o.summary.applications} application file(s); JD file: ${o.summary.jdFiles.join(", ") || "none"}`));
    case "not-imported":
      return console.log(dim("  folder not imported"));
    case "refused":
      return console.log(yellow(`  not attached: ${o.path}: ${o.reason}`));
    case "error":
      return console.log(red(`  ${o.message}`));
  }
}

async function main(): Promise<void> {
  const userId = resolveUser();
  // Set once readline exists.
  let ask: Confirm = async () => false;

  const app = new AssistantApp({
    userId,
    ui: {
      confirm: (req, ctx) => ask(req, ctx),
      progress: (msg) => process.stdout.write(dim(`\n  ${msg}`)),
      log: DEBUG ? (l) => console.error(dim(`[codex] ${l}`)) : undefined,
    },
    serviceTier: initialTier(),
    // FX_BASE=codex keeps Codex's built-in coding-agent prompt (for A/B comparison).
    codexBasePrompt: process.env.FX_BASE === "codex",
  });

  const acct = await app.start();
  if (!acct.loggedIn) {
    console.log("Not logged in. Starting login...");
    await app.login((msg) => console.log(cyan(msg)));
  }
  console.log(dim(`account: ${(await app.account()).description}   user: ${userId}`));
  if (process.argv.includes("--login")) {
    await app.close();
    return;
  }

  const { session, deletedOld } = await app.openSession();
  if (deletedOld) console.log(dim(`deleted ${deletedOld} conversation(s) older than 30 days`));
  console.log(dim(`model: ${session.model} (${session.reasoningEffort ?? "default"}, ${tierLabel(session.serviceTier)})  sandbox: ${session.sandbox}  approvals: ${session.approvalPolicy}`));
  console.log(dim("Type /help for commands. Drag files into this window to attach them.") + "\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  ask = async (req, ctx) => {
    // Ctrl+C stops the reply and withdraws the question (the app counts it as "no").
    const a = (await rl.question(yellow(`\n${confirmText(req)}\n[y/n] `), { signal: ctx?.signal })).trim().toLowerCase();
    return a === "y" || a === "yes" || a === "是";
  };

  let voice = null as (VoiceController & { ended: AbortController }) | null;
  let closing = false;

  const saveNotes = async (run: () => Promise<TaskNote[] | null>) => {
    if (!app.hasConversation()) {
      await run();
      return;
    }
    process.stdout.write(dim("saving notes from this conversation... "));
    try {
      printNotes(await run());
    } catch (e) {
      printNotes(null, (e as Error).message);
    }
  };

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await saveNotes(() => app.close());
    process.exit(0);
  };
  rl.on("SIGINT", () => {
    if (voice) voice.stop();
    else if (app.isBusy()) app.stop().catch((e) => console.error(red(`interrupt failed: ${e.message}`)));
    else rl.close();
  });
  rl.on("close", shutdown);

  const runTurn = async (events: AsyncIterable<AppEvent>, skill?: string) => {
    process.stdout.write(cyan("bot> "));
    if (skill) process.stdout.write(dim(`[skill: ${skill}] `));
    const print = makePrinter();
    for await (const ev of events) print(ev);
  };

  const startVoice = async () => {
    let print = makePrinter();
    const ended = new AbortController();
    try {
      const c = await app.startVoice({
        onRequest: (text, mode) => {
          console.log(`\n${cyan("you (voice)>")} ${text}${mode === "steer" ? dim("  [added to the current task]") : ""}`);
          if (mode === "new") {
            process.stdout.write(cyan("bot> "));
            print = makePrinter();
          }
        },
        onEvent: (ev) => print(ev),
        onSaid: (text) => console.log(dim(`voice: ${text}`)),
        onConfirmSkipped: (req) => console.log(dim(`\n[not saved: confirmations need the keyboard, so they are skipped in voice mode. Ask again by typing after voice mode.]\n${confirmText(req)}`)),
        onError: (m) => console.log(red(`\n[voice] ${m}`)),
        onEnded: ({ reason, byUser, billedSeconds }) => {
          if (byUser) {
            if (reason !== "stopped") console.log(dim(`\nvoice stopping: ${reason}`));
            console.log(dim(`voice off (billed ${billedSeconds}s as reported by the API, about US$${((billedSeconds / 60) * 0.05).toFixed(2)})`));
          } else {
            console.log(red(`\n[voice session ended: ${reason}]`));
          }
          voice = null;
          ended.abort(); // releases the "press Enter" wait
        },
      });
      voice = { ...c, ended };
      console.log(dim(`voice on. mic: ${c.device}. Speak now; press Enter to stop (stops by itself after ${VOICE_IDLE_SECONDS}s of silence). Use headphones to avoid echo.`));
    } catch (e) {
      console.log(red((e as Error).message));
    }
  };

  // Reminders at startup: a local CLI cannot notify while closed, so they show when it starts.
  try {
    const due = app.reminders();
    if (due.length) {
      const overdue = due.filter((r) => r.overdue).length;
      console.log(yellow(`${due.length} reminder(s)${overdue ? `, ${overdue} overdue` : ""}:`));
      for (const r of due.slice(0, 5)) console.log(yellow(`  ${r.overdue ? "OVERDUE " : ""}${r.due}  ${r.title}`));
      console.log(dim("  /reminders for details, or ask me about them.\n"));
    }
  } catch (e) {
    console.log(red(`reminders unavailable: ${(e as Error).message}`));
  }

  // First start in this workspace: offer the setup interview (the answers are much better with a profile).
  if (app.needsSetup()) {
    console.log(dim("No business profile yet. With one, I can fill in contracts and letters and apply the right state, award and rules."));
    if (await ask({ kind: "setup", title: "Set up your business profile now? (about 3 minutes; /setup any time)" })) await runTurn(app.setup(), "business-setup");
  }

  while (true) {
    let line: string;
    try {
      if (voice) {
        const { ended } = voice;
        try {
          await rl.question("", { signal: ended.signal });
        } catch (e) {
          if (!ended.signal.aborted) throw e; // readline closed → exit below
        }
        voice?.stop();
        continue;
      }
      line = (await rl.question(cyan("you> "))).trim();
    } catch {
      break; // readline closed
    }
    if (!line) continue;
    const [cmd, ...restWords] = line.startsWith("/") ? line.slice(1).split(/\s+/) : [""];
    const rest = restWords.join(" ").trim();

    try {
      switch (line.startsWith("/") ? cmd : "") {
        case "": {
          // Dropped files arrive as paths in the line.
          const { text, outcomes } = await app.takeDroppedPaths(line);
          outcomes.forEach(printAttachOutcome);
          if (!text) {
            if (app.hasPendingAttachments()) console.log(dim("  What should I do with it? Type your request."));
            continue;
          }
          await runTurn(app.send(text, { title: line }));
          continue;
        }
        case "setup":
          await runTurn(app.setup(), "business-setup");
          continue;
        case "reminders": {
          const today = todayLocal();
          console.log(dim(formatReminders(app.reminders(), today)));
          continue;
        }
        case "staff": {
          const list = app.staff(rest === "all");
          console.log(dim(list.length ? list.map((e) => `  ${employeeLine(e)}`).join("\n") : "The employee register is empty. Tell me about your staff in the chat to add them (every change is confirmed)."));
          continue;
        }
        case "profile": {
          const p = app.profile();
          if (!p.exists) console.log(dim("No business profile yet. Run /setup (a short interview)."));
          else console.log(dim(p.lines.join("\n") + `\n(stored in ${p.path}; to change something, tell me in the chat or run /setup)`));
          console.log(dim(`Policy documents in ${p.policiesDir}:`));
          console.log(dim(p.policies.length ? p.policies.map((x) => `  ${x.id}`).join("\n") : "  (none: put your handbook or policies here as PDF, DOCX, TXT or MD)"));
          continue;
        }
        case "exit":
          rl.close();
          return;
        case "help":
          console.log(dim(HELP));
          continue;
        case "new":
          await saveNotes(() => app.newConversation());
          console.log(dim("new conversation") + "\n");
          continue;
        case "history": {
          const list = await app.history();
          if (!list.length) console.log(dim("no earlier conversations"));
          list.forEach((s, i) => console.log(dim(`${String(i + 1).padStart(2)}. ${s.startedAt.slice(0, 16).replace("T", " ")}  ${s.title}`)));
          continue;
        }
        case "resume": {
          const target = (await app.history())[Number(rest) - 1];
          if (!target) {
            console.log(dim("usage: /resume <n>  (n from /history)"));
            continue;
          }
          if (target.threadId === app.sessionInfo()?.threadId) {
            console.log(dim("that is the current conversation"));
            continue;
          }
          await saveNotes(async () => (await app.resume(target)).notes);
          console.log(dim(`resumed: ${target.title}`) + "\n");
          continue;
        }
        case "skills": {
          const skills = app.skills();
          if (!skills.length) console.log(dim("no skills installed"));
          for (const s of skills) console.log(dim(`/${s.name}  ${s.description}`));
          continue;
        }
        case "remember":
          if (!rest) console.log(dim("usage: /remember <text>"));
          else await runTurn(app.remember(rest));
          continue;
        case "memories": {
          const { preferences, notes } = app.memories();
          console.log(dim("Preferences:"));
          console.log(dim(preferences.length ? preferences.map((p) => `  [${p.id}] ${p.text}  (${p.source}, ${p.createdAt.slice(0, 10)})`).join("\n") : "  (none)"));
          console.log(dim("Work notes (expire after 30 days):"));
          console.log(dim(notes.length ? notes.map((t) => `  [${t.id}] ${t.text}  (${t.createdAt.slice(0, 10)})`).join("\n") : "  (none)"));
          console.log(dim("Changes apply from the next conversation (/new)."));
          continue;
        }
        case "forget": {
          const removed = rest ? app.forget(rest) : null;
          console.log(dim(removed ? `forgot [${removed.id}]: ${removed.text}` : "usage: /forget <id>  (id from /memories)"));
          continue;
        }
        case "jobs": {
          const jobs = app.jobs();
          console.log(dim(`Jobs folder: ${app.folders().jobs}`));
          if (!jobs.length) console.log(dim("  (no jobs yet: create a folder per role under Jobs, or use /import <path> <job>)"));
          for (const j of jobs) console.log(dim(`  ${j.job}  (${j.files} file(s); criteria: ${j.criteria})`));
          continue;
        }
        case "import": {
          // /import <path> [job]   (the path may be quoted; the job defaults to the folder name)
          const m = rest.match(/^"([^"]+)"\s*(.*)$/) ?? rest.match(/^(\S+)\s*(.*)$/);
          if (!m) {
            console.log(dim("usage: /import <folder or file path> [job name]"));
            continue;
          }
          const { job, summary: s } = await app.importJob(m[1], m[2] || null);
          console.log(dim(`\nimported into job "${job}": ${s.applications} application file(s), ${s.duplicates.length} duplicate(s), ${s.unreadable.length} unreadable; JD file: ${s.jdFiles.join(", ") || "none"}`));
          continue;
        }
        case "screen": {
          const job = rest.trim();
          if (!job) {
            console.log(dim("usage: /screen <job>   (see /jobs)"));
            continue;
          }
          const r = await app.screen(job);
          if (r.status === "no-jd") console.log(dim(`\nNo JD file in Jobs/${job} (name it JD..., e.g. "JD.docx"). Or ask in the chat: "screen ${job} against this JD: ...".`));
          else if (r.status === "not-confirmed") console.log(dim("Not confirmed. To change them, describe the changes in the chat."));
          else {
            console.log("\n" + r.summary);
            console.log(dim(`\nFor a file: /report ${job} [word|excel|both]  (or ask in the chat)`));
          }
          continue;
        }
        case "report": {
          // /report <job> [word|excel|both]   (Word by default; uses existing results, screens nothing new)
          const [job, fmtWord] = rest.split(/\s+/);
          const format = ({ word: "docx", docx: "docx", excel: "xlsx", xlsx: "xlsx", both: "both" } as const)[(fmtWord ?? "word").toLowerCase() as "word"];
          if (!job || !format) {
            console.log(dim("usage: /report <job> [word|excel|both]"));
            continue;
          }
          for (const f of await app.report(job, format)) console.log(dim(`\nsaved: ${f}`));
          continue;
        }
        case "files": {
          const sub = rest.split(/\s+/)[0];
          const arg = rest.slice(sub.length).trim();
          if (sub === "set") {
            if (!arg) throw new Error("usage: /files set <path>");
            app.setFilesRoot(arg);
          } else if (sub === "reset") {
            app.resetFilesRoot();
          } else if (sub === "open") {
            spawn("explorer.exe", [app.folders().root], { detached: true, stdio: "ignore" }).unref();
          } else if (sub) {
            throw new Error("usage: /files [open | set <path> | reset]");
          }
          const { folders: f, inbox } = app.files();
          console.log(dim(`Jobs:     ${f.jobs}\nInbox:    ${f.inbox}\nOutbox:   ${f.outbox}\nPolicies: ${f.policies}`));
          const lines = inbox.map((i) => `  ${i.name}  (${Math.max(1, Math.round(i.size / 1024))} KB)${i.readable ? "" : "  [unsupported type]"}`);
          console.log(dim(lines.length ? lines.join("\n") : "  (Inbox is empty)"));
          continue;
        }
        case "voice": {
          if (rest.startsWith("device")) {
            const { devices, current } = app.microphones();
            const n = Number(rest.slice(6).trim());
            if (n >= 1 && n <= devices.length) {
              app.setMicrophone(devices[n - 1]);
              console.log(dim(`microphone: ${devices[n - 1]}`));
            } else {
              const lines = devices.map((m, i) => `  ${i + 1}. ${m}${m === current ? "  (current)" : ""}`);
              console.log(dim(lines.length ? `${lines.join("\n")}\nuse /voice device <n> to pick one` : "no microphones found"));
            }
          } else {
            await startVoice();
          }
          continue;
        }
        case "tier": {
          const label = app.setTier(rest);
          console.log(dim(label ? `tier: ${label} (from the next message)` : "usage: /tier fast|standard"));
          continue;
        }
        default: {
          // Explicit skill: "/<skill-name or unique prefix> request".
          const r = app.resolveSkill(cmd);
          if (!r || "ambiguous" in r) {
            console.log(dim(r ? `ambiguous: ${r.ambiguous.map((s) => "/" + s).join(" ")}` : `unknown command /${cmd}; type /help`));
            continue;
          }
          if (!rest) console.log(dim(`usage: /${r.skill} <your request>`));
          else await runTurn(app.send(rest, { skill: r.skill, title: line }), r.skill);
        }
      }
    } catch (e) {
      console.log(red((e as Error).message));
    }
  }
}

main().catch((err) => {
  console.error(red(`fatal: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
