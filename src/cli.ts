import { createInterface } from "node:readline/promises";
import { userInfo } from "node:os";
import type { Engine, EngineEvent, SessionInfo } from "./engine/types";
import type { UserMemory } from "./memory/store";
import { userSection } from "./memory/context";
import { summarizeSession } from "./memory/summarize";
import { createAssistant } from "./assistant";
import { spawn } from "node:child_process";
import { validateFilesRoot, ensureFolders } from "./files/folders";
import { listInbox } from "./files/tools";
import { basename } from "node:path";
import { jobDir, listJobs, walk } from "./files/folders";
import { attachToInbox, findDroppedPaths, importIntoJob, rewriteMessage, type AttachResult } from "./files/attach";
import { profileLines } from "./business/profile";
import { listPolicies } from "./business/policies";
import { employeeLine } from "./business/register";
import { formatReminders, remindersFor, todayLocal } from "./business/reminders";
import { looksLikePayCalculation, PAY_GUARD_WARNING } from "./business/payGuard";
import { formatCriteria, ingestJob, jdFromFolder, proposeCriteria, purgeMissingJobs, screenJob, SCREEN_BATCH_LIMIT, SCREEN_CONCURRENCY } from "./screening/pipeline";
import { chatSummary, saveReports } from "./screening/report";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./assistant";
import { LiveSession } from "./voice/liveSession";
import { VoiceBridge } from "./voice/bridge";
import { Microphone, Speaker, ffmpegAvailable, listMicrophones } from "./voice/audio";

const DEBUG = process.env.FX_DEBUG === "1";
/** Stored conversations older than this are deleted at startup. */
const SESSION_RETENTION_DAYS = 30;
/** Voice mode stops by itself after this much silence (no speech from the user or the voice, assistant idle). */
const VOICE_IDLE_SECONDS = Number(process.env.FX_VOICE_IDLE_SECONDS ?? 60);

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

// User-facing tier names -> app-server service tier ids.
const TIERS: Record<string, string> = { fast: "priority", priority: "priority", standard: "default", default: "default" };
const tierLabel = (id: string | null) => (id === "priority" ? "fast" : "standard");

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

async function main(): Promise<void> {
  const userId = resolveUser();

  // Set once readline exists; memory tools use it to ask the user.
  let confirm: (q: string) => Promise<boolean> = async () => false;

  const { engine, mem, folders, business, catalog, register, paths } = createAssistant({
    userId,
    confirm: (q) => confirm(q),
    serviceTier: initialTier(),
    // FX_BASE=codex keeps Codex's built-in coding-agent prompt (for A/B comparison).
    codexBasePrompt: process.env.FX_BASE === "codex",
    onLog: DEBUG ? (l) => console.error(dim(`[codex] ${l}`)) : undefined,
    onProgress: (msg) => process.stdout.write(dim(`\n  ${msg}`)),
  });

  await engine.start();

  const acct = await engine.account();
  if (!acct.loggedIn) {
    console.log("Not logged in. Starting login...");
    await engine.login((msg) => console.log(cyan(msg)));
  }
  console.log(dim(`account: ${(await engine.account()).description}   user: ${userId}`));
  if (process.argv.includes("--login")) {
    await engine.close();
    return;
  }

  await cleanupOldSessions(engine, mem);

  let session: SessionInfo = await engine.newSession();
  let recorded = false; // this session is in the user's history once it has a message
  console.log(
    dim(`model: ${session.model} (${session.reasoningEffort ?? "default"}, ${tierLabel(session.serviceTier)})  sandbox: ${session.sandbox}  approvals: ${session.approvalPolicy}`),
  );
  console.log(dim("Type /help for commands. Drag files into this window to attach them.") + "\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  confirm = async (q) => {
    if (voice) {
      // A yes/no needs the keyboard (memory proposals, business profile changes, register writes).
      console.log(dim(`\n[not saved: confirmations need the keyboard, so they are skipped in voice mode. Ask again by typing after voice mode.]\n${q}`));
      return false;
    }
    const a = (await rl.question(yellow(`\n${q} [y/n] `))).trim().toLowerCase();
    return a === "y" || a === "yes" || a === "是";
  };
  let busy = false;
  let closing = false;

  /** Memory write mechanism 4: save work notes from the conversation that is ending. */
  const saveNotes = async () => {
    if (!engine.transcript().some((m) => m.role === "user")) return;
    process.stdout.write(dim("saving notes from this conversation... "));
    try {
      const notes = await summarizeSession(engine, mem);
      console.log(dim(notes.length ? "" : "nothing to save"));
      for (const n of notes) console.log(dim(`  note saved [${n.id}]: ${n.text}`));
    } catch (e) {
      console.log(red(`failed: ${(e as Error).message}`));
    }
  };

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await saveNotes();
    await engine.close();
    process.exit(0);
  };

  rl.on("SIGINT", () => {
    if (voice) voice.stop();
    else if (busy) engine.interrupt().catch((e) => console.error(red(`interrupt failed: ${e.message}`)));
    else rl.close();
  });
  rl.on("close", shutdown);

  /** Renders one assistant turn's events; shared by typed and spoken requests. */
  const makePrinter = () => {
    const started = Date.now();
    let firstTokenMs: number | null = null;
    let streamed = "";
    return (ev: EngineEvent) => {
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
          // Backstop for the "no pay calculations" rule (warns, does not block).
          if (looksLikePayCalculation(ev.text)) process.stdout.write(yellow(`\n! ${PAY_GUARD_WARNING}`));
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
  };

  const recordSession = (title: string) => {
    if (recorded) return;
    mem.recordSession({ threadId: session.threadId, title: title.slice(0, 60), startedAt: new Date().toISOString() });
    recorded = true;
  };

  /** `typed` is what the user entered (used as the history title); `text` is what the model gets. */
  const runTurn = async (text: string, opts: { skill?: string; typed?: string; images?: string[] } = {}) => {
    const { skill } = opts;
    recordSession(opts.typed ?? text);
    busy = true;
    process.stdout.write(cyan("bot> "));
    if (skill) process.stdout.write(dim(`[skill: ${skill}] `));
    const print = makePrinter();
    for await (const ev of engine.send(text, { skill, images: opts.images })) print(ev);
    busy = false;
  };

  const runSetup = () =>
    runTurn("Start the business setup interview. Ask in English unless I answer in another language.", { skill: "business-setup", typed: "/setup" });

  // ------------------------------------------------------------------ drag and drop
  // Files dropped into the terminal arrive as paths. Attachments from a message that
  // had no request yet wait here and go with the next message.
  let pending: { notes: string[]; images: string[] } = { notes: [], images: [] };
  const NOTE = /\[(?:attached|imported folder)[^\]]*\]/g;

  /** Copies dropped files into the Inbox (a folder: offers a job import) and rewrites the message. */
  const handleDrops = async (line: string): Promise<{ text: string; images: string[] } | null> => {
    const dropped = findDroppedPaths(line);
    if (!dropped.length) return { text: line, images: [] };
    const results: AttachResult[] = [];
    const images: string[] = [];
    let text = line;
    for (const d of dropped) {
      const r = attachToInbox(folders(), d.path, [paths.codexHome, paths.memoryRoot, join(paths.projectRoot, "src")]);
      results.push(r);
      if (r.kind === "file") {
        console.log(dim(`  attached: ${r.name}${r.reused ? " (already in the Inbox)" : " (copied to the Inbox)"}`));
        if (r.image) images.push(r.path);
      } else if (r.kind === "refused") {
        console.log(yellow(`  not attached: ${d.path}: ${r.reason}`));
        text = text.replace(d.raw, "");
      } else {
        const name = basename(r.source);
        if (await confirm(`Import the folder "${name}" as a job, to screen the resumes in it?`)) {
          try {
            const { job, summary } = await importIntoJob(folders(), catalog(), r.source, null, (m) => console.log(dim(`  ${m}`)));
            console.log(dim(`  imported into job "${job}": ${summary.applications} application file(s); JD file: ${summary.jdFiles.join(", ") || "none"}`));
            text = text.replace(d.raw, `[imported folder as job "${job}" (${summary.applications} application file(s))]`);
          } catch (e) {
            console.log(red(`  ${(e as Error).message}`));
            text = text.replace(d.raw, "");
          }
        } else {
          console.log(dim("  folder not imported"));
          text = text.replace(d.raw, "");
        }
      }
    }
    text = rewriteMessage(text, dropped, results);
    // Only attachments (or nothing usable), no request yet: keep attachments for the next message.
    if (!text.replace(NOTE, "").trim()) {
      const notes = text.match(NOTE) ?? [];
      if (notes.length) {
        pending = { notes: [...pending.notes, ...notes], images: [...pending.images, ...images] };
        console.log(dim("  What should I do with it? Type your request."));
      }
      return null;
    }
    return { text, images };
  };

  // ------------------------------------------------------------------ voice
  // Assigned inside startVoice(); the cast keeps TypeScript from narrowing it to null.
  // `ended` releases the main loop's "press Enter" wait when voice stops by itself (idle, session end).
  let voice = null as { stop: (reason?: string) => void; ended: AbortController } | null;

  const startVoice = async () => {
    try {
      process.loadEnvFile(join(ROOT, ".env"));
    } catch {
      /* no .env: checked below */
    }
    const apiKey = process.env.VOICE_OPENAI_API_KEY;
    if (!apiKey) return console.log(red("voice needs VOICE_OPENAI_API_KEY in .env (see .env.example)"));
    if (!ffmpegAvailable()) return console.log(red("voice needs ffmpeg and ffplay on PATH"));
    const device = mem.settings().micDevice ?? listMicrophones()[0];
    if (!device) return console.log(red("no microphone found; /voice device lists devices"));

    const live = new LiveSession({
      apiKey,
      model: process.env.VOICE_MODEL || "gpt-live-1",
      voice: process.env.VOICE_NAME || "gleam",
      instructions: readFileSync(join(ROOT, "prompts/voice.md"), "utf8"),
    });
    const speaker = new Speaker();
    const mic = new Microphone(device);
    let print = makePrinter();
    let said = "";
    let seconds = 0;
    const ended = new AbortController();
    // Idle auto-stop: nobody spoke (user or voice) and the assistant is not working.
    let lastActivity = Date.now();
    const idleTimer = setInterval(() => {
      if (engine.isBusy()) lastActivity = Date.now();
      else if (Date.now() - lastActivity > VOICE_IDLE_SECONDS * 1000) voice?.stop(`no one spoke for ${VOICE_IDLE_SECONDS}s`);
    }, 2000);

    live.on("audio", (pcm) => speaker.play(pcm));
    live.on("usage", (s) => (seconds = s));
    live.on("inputTranscript", () => (lastActivity = Date.now()));
    // Show what the voice says on its own (small talk); delegated answers are shown in full.
    live.on("outputTranscript", (d) => {
      lastActivity = Date.now();
      said += d.text;
      if (/[.!?。！？]\s*$/.test(said) && !engine.isBusy()) {
        console.log(dim(`voice: ${said.trim()}`));
        said = "";
      }
    });
    live.on("error", (m) => console.log(red(`\n[voice error] ${m}`)));
    let stopping = false;
    live.once("closed", (reason) => {
      if (stopping) {
        console.log(dim(`voice off (billed ${seconds}s as reported by the API, about US$${((seconds / 60) * 0.05).toFixed(2)})`));
      } else {
        console.log(red(`\n[voice session ended: ${reason}]`));
        clearInterval(idleTimer);
        mic.stop();
        speaker.stop();
        voice = null;
        ended.abort();
      }
    });
    new VoiceBridge(live, engine, {
      onRequest: (text, mode) => {
        said = "";
        recordSession(text);
        console.log(`\n${cyan("you (voice)>")} ${text}${mode === "steer" ? dim("  [added to the current task]") : ""}`);
        if (mode === "new") {
          process.stdout.write(cyan("bot> "));
          print = makePrinter();
        }
      },
      onEvent: (ev) => print(ev),
      onError: (m) => console.log(red(`\n[voice bridge] ${m}`)),
    });

    try {
      await live.start();
    } catch (e) {
      return console.log(red(`could not start voice: ${(e as Error).message}`));
    }
    speaker.start();
    mic.on("chunk", (c) => live.appendAudio(c));
    mic.on("error", (m) => console.log(red(`\n[${m}]`)));
    mic.start();
    voice = {
      ended,
      stop: (reason?: string) => {
        if (stopping) return;
        stopping = true;
        clearInterval(idleTimer);
        if (reason) console.log(dim(`\nvoice stopping: ${reason}`));
        mic.stop();
        speaker.stop();
        live.close(); // usage is printed when the session confirms it closed
        voice = null;
        ended.abort();
      },
    };
    console.log(dim(`voice on. mic: ${device}. Speak now; press Enter to stop (stops by itself after ${VOICE_IDLE_SECONDS}s of silence). Use headphones to avoid echo.`));
  };

  // Reminders at startup: a local CLI cannot notify while closed, so they show when it starts.
  try {
    const due = remindersFor(register(), business());
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
  if (!business().exists()) {
    console.log(dim("No business profile yet. With one, I can fill in contracts and letters and apply the right state, award and rules."));
    if (await confirm("Set up your business profile now? (about 3 minutes; /setup any time)")) await runSetup();
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

    switch (line.startsWith("/") ? cmd : "") {
      case "": {
        const msg = await handleDrops(line);
        if (!msg) continue;
        const text = [...pending.notes, msg.text].join(" ");
        const images = [...pending.images, ...msg.images];
        pending = { notes: [], images: [] };
        await runTurn(text, { typed: line, images });
        continue;
      }
      case "setup":
        await runSetup();
        continue;
      case "reminders": {
        const today = todayLocal();
        console.log(dim(formatReminders(remindersFor(register(), business(), today), today)));
        continue;
      }
      case "staff": {
        const list = register().list({ includeLeft: rest === "all" });
        console.log(dim(list.length ? list.map((e) => `  ${employeeLine(e)}`).join("\n") : "The employee register is empty. Tell me about your staff in the chat to add them (every change is confirmed)."));
        continue;
      }
      case "profile": {
        const b = business();
        if (!b.exists()) console.log(dim("No business profile yet. Run /setup (a short interview)."));
        else console.log(dim(profileLines(b.get()).join("\n") + `\n(stored in ${b.path}; to change something, tell me in the chat or run /setup)`));
        const pol = listPolicies(folders());
        console.log(dim(`Policy documents in ${folders().policies}:`));
        console.log(dim(pol.length ? pol.map((x) => `  ${x.id}`).join("\n") : "  (none: put your handbook or policies here as PDF, DOCX, TXT or MD)"));
        continue;
      }
      case "exit":
        rl.close();
        return;
      case "help":
        console.log(dim(HELP));
        continue;
      case "new":
        await saveNotes();
        session = await engine.newSession();
        recorded = false;
        console.log(dim("new conversation") + "\n");
        continue;
      case "history": {
        const stored = new Set((await engine.listStoredSessions()).map((s) => s.threadId));
        const list = mem.sessions().filter((s) => stored.has(s.threadId)).slice(0, 15);
        if (!list.length) console.log(dim("no earlier conversations"));
        list.forEach((s, i) => console.log(dim(`${String(i + 1).padStart(2)}. ${s.startedAt.slice(0, 16).replace("T", " ")}  ${s.title}`)));
        continue;
      }
      case "resume": {
        const stored = new Set((await engine.listStoredSessions()).map((s) => s.threadId));
        const list = mem.sessions().filter((s) => stored.has(s.threadId)).slice(0, 15);
        const target = list[Number(rest) - 1];
        if (!target) {
          console.log(dim("usage: /resume <n>  (n from /history)"));
          continue;
        }
        if (target.threadId === session.threadId) {
          console.log(dim("that is the current conversation"));
          continue;
        }
        await saveNotes();
        // The stored thread keeps its original instructions; send this user's current memory with the next message.
        const update = `<memory_update>\nThis conversation is being resumed. Current memory (overrides anything older in this conversation):\n\n${userSection(mem)}\n</memory_update>`;
        session = await engine.resumeSession(target.threadId, update);
        recorded = true;
        console.log(dim(`resumed: ${target.title}`) + "\n");
        continue;
      }
      case "skills": {
        const skills = engine.listSkills();
        if (!skills.length) console.log(dim("no skills installed"));
        for (const s of skills) console.log(dim(`/${s.name}  ${s.description}`));
        continue;
      }
      case "remember":
        if (!rest) console.log(dim("usage: /remember <text>"));
        // Goes through the model so preferences that break the recruitment principles are refused.
        else await runTurn(`Remember this for future conversations: ${rest}`, { typed: line });
        continue;
      case "memories": {
        const prefs = mem.preferences();
        const tasks = mem.tasks();
        console.log(dim("Preferences:"));
        console.log(dim(prefs.length ? prefs.map((p) => `  [${p.id}] ${p.text}  (${p.source}, ${p.createdAt.slice(0, 10)})`).join("\n") : "  (none)"));
        console.log(dim("Work notes (expire after 30 days):"));
        console.log(dim(tasks.length ? tasks.map((t) => `  [${t.id}] ${t.text}  (${t.createdAt.slice(0, 10)})`).join("\n") : "  (none)"));
        console.log(dim("Changes apply from the next conversation (/new)."));
        continue;
      }
      case "forget": {
        const removed = rest ? mem.forget(rest) : null;
        console.log(dim(removed ? `forgot [${removed.id}]: ${removed.text}` : "usage: /forget <id>  (id from /memories)"));
        continue;
      }
      case "jobs": {
        try {
          const f = folders();
          const jobs = listJobs(f);
          purgeMissingJobs(catalog(), jobs);
          console.log(dim(`Jobs folder: ${f.jobs}`));
          if (!jobs.length) console.log(dim("  (no jobs yet: create a folder per role under Jobs, or use /import <path> <job>)"));
          for (const j of jobs) {
            const n = walk(jobDir(f, j)).files.length;
            const r = catalog().latestRubric(j);
            console.log(dim(`  ${j}  (${n} file(s); criteria: ${r ? `v${r.version}${r.confirmed ? " confirmed" : " not confirmed"}` : "none"})`));
          }
        } catch (e) {
          console.log(red((e as Error).message));
        }
        continue;
      }
      case "import": {
        // /import <path> [job]   (the path may be quoted; the job defaults to the folder name)
        const m = rest.match(/^"([^"]+)"\s*(.*)$/) ?? rest.match(/^(\S+)\s*(.*)$/);
        if (!m) {
          console.log(dim("usage: /import <folder or file path> [job name]"));
          continue;
        }
        try {
          // Never overwrites files already in the job folder.
          const { job, summary: s } = await importIntoJob(folders(), catalog(), m[1], m[2], (msg) => console.log(dim(`  ${msg}`)));
          console.log(dim(`imported into job "${job}": ${s.applications} application file(s), ${s.duplicates.length} duplicate(s), ${s.unreadable.length} unreadable; JD file: ${s.jdFiles.join(", ") || "none"}`));
        } catch (e) {
          console.log(red((e as Error).message));
        }
        continue;
      }
      case "screen": {
        // Deterministic path: no model turn needed to decide what to do.
        const job = rest.trim();
        if (!job) {
          console.log(dim("usage: /screen <job>   (see /jobs)"));
          continue;
        }
        try {
          const progress = (msg: string) => console.log(dim(`  ${msg}`));
          const s = await ingestJob(catalog(), folders(), job, progress);
          let r = catalog().latestRubric(job);
          if (!r || !r.confirmed) {
            if (!r) {
              const jd = await jdFromFolder(folders(), job, s.jdFiles);
              if (!jd) {
                console.log(dim(`No JD file in Jobs/${job} (name it JD..., e.g. "JD.docx"). Or ask in the chat: "screen ${job} against this JD: ...".`));
                continue;
              }
              progress(`drafting criteria from ${jd.source}...`);
              r = await proposeCriteria(engine, catalog(), job, jd.text);
            }
            console.log(dim(formatCriteria(r)));
            if (!(await confirm("Use these criteria for screening?"))) {
              console.log(dim("Not confirmed. To change them, describe the changes in the chat."));
              continue;
            }
            catalog().confirmRubric(job, r.version);
          }
          const result = await screenJob(engine, catalog(), folders(), job, { onProgress: progress });
          console.log("\n" + chatSummary(result));
          console.log(dim(`\nFor a file: /report ${job} [word|excel|both]  (or ask in the chat)`));
        } catch (e) {
          console.log(red((e as Error).message));
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
        try {
          const result = await screenJob(engine, catalog(), folders(), job, { limit: 0 });
          if (!result.ranked.length) throw new Error(`no screening results for "${job}" yet; run /screen ${job} first`);
          console.log(dim("  writing the report..."));
          for (const f of await saveReports(engine, folders(), result, format)) console.log(dim(`saved: ${join(folders().outbox, f)}`));
        } catch (e) {
          console.log(red((e as Error).message));
        }
        continue;
      }
      case "files": {
        const sub = rest.split(/\s+/)[0];
        const arg = rest.slice(sub.length).trim();
        try {
          if (sub === "set") {
            if (!arg) throw new Error("usage: /files set <path>");
            const root = validateFilesRoot(arg, paths);
            ensureFolders(root);
            mem.updateSettings({ filesRoot: root });
          } else if (sub === "reset") {
            mem.updateSettings({ filesRoot: undefined });
          } else if (sub === "open") {
            spawn("explorer.exe", [folders().root], { detached: true, stdio: "ignore" }).unref();
          } else if (sub) {
            throw new Error("usage: /files [open | set <path> | reset]");
          }
          const f = folders();
          const items = listInbox(f);
          console.log(dim(`Jobs:     ${f.jobs}\nInbox:    ${f.inbox}\nOutbox:   ${f.outbox}\nPolicies: ${f.policies}`));
          const lines = items.map(
            (i) => `  ${i.name}  (${Math.max(1, Math.round(i.size / 1024))} KB)${i.readable ? "" : "  [unsupported type]"}`,
          );
          console.log(dim(lines.length ? lines.join("\n") : "  (Inbox is empty)"));
        } catch (e) {
          console.log(red((e as Error).message));
        }
        continue;
      }
      case "voice": {
        if (rest.startsWith("device")) {
          const mics = listMicrophones();
          const n = Number(rest.slice(6).trim());
          if (n >= 1 && n <= mics.length) {
            mem.updateSettings({ micDevice: mics[n - 1] });
            console.log(dim(`microphone: ${mics[n - 1]}`));
          } else {
            const current = mem.settings().micDevice ?? mics[0];
            const lines = mics.map((m, i) => `  ${i + 1}. ${m}${m === current ? "  (current)" : ""}`);
            console.log(dim(lines.length ? `${lines.join("\n")}\nuse /voice device <n> to pick one` : "no microphones found"));
          }
        } else {
          await startVoice();
        }
        continue;
      }
      case "tier": {
        const id = TIERS[rest.toLowerCase()];
        if (!id) console.log(dim("usage: /tier fast|standard"));
        else {
          engine.setServiceTier(id);
          console.log(dim(`tier: ${tierLabel(id)} (from the next message)`));
        }
        continue;
      }
      default: {
        // Explicit skill: "/<skill-name or unique prefix> request".
        const matches = engine.listSkills().filter((s) => s.name.startsWith(cmd));
        const exact = matches.find((s) => s.name === cmd);
        if (!exact && matches.length !== 1) {
          console.log(dim(matches.length ? `ambiguous: ${matches.map((s) => "/" + s.name).join(" ")}` : `unknown command /${cmd}; type /help`));
          continue;
        }
        const skill = (exact ?? matches[0]).name;
        if (!rest) console.log(dim(`usage: /${skill} <your request>`));
        else await runTurn(rest, { skill, typed: line });
      }
    }
  }
}

/** Retention: delete stored conversations (all users) not updated in SESSION_RETENTION_DAYS. */
async function cleanupOldSessions(engine: Engine, mem: UserMemory): Promise<void> {
  const cutoff = Date.now() - SESSION_RETENTION_DAYS * 86_400_000;
  const old = (await engine.listStoredSessions()).filter((s) => s.updatedAt.getTime() < cutoff);
  for (const s of old) await engine.deleteStoredSession(s.threadId);
  mem.dropSessions(new Set(old.map((s) => s.threadId)));
  if (old.length) console.log(dim(`deleted ${old.length} conversation(s) older than ${SESSION_RETENTION_DAYS} days`));
}

main().catch((err) => {
  console.error(red(`fatal: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
