// Screenshots and a short video of MeritAI for the README (docs/images/), from the demo (the synthetic
// sample business, fake engine: no model, no cost). Electron opens the page off-screen, clicks through
// the flows and saves PNGs; the video's frames go through ffmpeg (MP4 and GIF).
//
//   npm run ui:fake -- --demo-dir shots --reseed --no-open --port 5190      (and, for the first-run
//   screen, a second one with --fresh on 5191), then (electron.exe directly: npx hides its output):
//   node_modules/electron/dist/electron.exe scripts/docs-media.cjs <url of 5190>
//   node_modules/electron/dist/electron.exe scripts/docs-media.cjs <url of 5191> --first-run
//   node_modules/electron/dist/electron.exe scripts/docs-media.cjs <url of a reseeded 5190> --clips[=screening,email]
// --clips records one video per feature for the product page (docs/index.html). Each run changes the
// demo's data, so reseed the server before the stills and again before the clips.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const url = process.argv.slice(2).find((a) => a.startsWith("http"));
// --first-run: only the first-run screen (a server started with --fresh).
const firstRunOnly = process.argv.includes("--first-run");
const OUT = path.join(__dirname, "..", "docs", "images");
// One folder per run (Windows can leave a just-deleted folder unusable for a while); removed on quit.
const FRAMES = path.join(require("os").tmpdir(), `meritai-frames-${process.pid}`);
app.on("quit", () => fs.rmSync(FRAMES, { recursive: true, force: true }));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Page helpers, run inside the page.
const HELPERS = `
window.__h = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  btn(text, root = document) {
    const all = [...root.querySelectorAll("button, a, [role=menuitem], [role=tab], [role=radio]")];
    return all.find((b) => b.textContent.replace(/\\s+/g, " ").trim() === text) || all.find((b) => (b.getAttribute("aria-label") || "") === text) || all.find((b) => b.textContent.replace(/\\s+/g, " ").trim().startsWith(text));
  },
  click(text, root) { const b = this.btn(text, root); if (!b) throw new Error("no button: " + text); b.click(); return true; },
  nav(label) { const b = [...document.querySelectorAll(".nav .nav-item, .nav .nav-icon")].find((x) => x.textContent.includes(label) || x.getAttribute("aria-label") === label); if (!b) throw new Error("no nav: " + label); b.click(); },
  set(el, v) { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); },
  async type(id, text, ms = 28) { const t = document.getElementById(id); t.focus(); for (let i = 1; i <= text.length; i++) { this.set(t, text.slice(0, i)); await this.sleep(ms); } },
  enter(id) { document.getElementById(id).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); },
  async say(id, text, ms) { await this.type(id, text, ms); await this.sleep(300); this.enter(id); },
  async typeInto(el, text, ms = 40) { el.focus(); for (let i = 1; i <= text.length; i++) { this.set(el, text.slice(0, i)); await this.sleep(ms); } },
  async until(f, ms = 30000) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timed out: " + f); await this.sleep(150); } },
  // Settings from the menu under the owner's name (label: "Settings" or "设置").
  async settings(label = "Settings") {
    document.querySelector(".me, .me-icon").click();
    await this.until(() => [...document.querySelectorAll("[role=menuitem], .menu button")].some((b) => b.textContent.trim().startsWith(label)), 5000);
    [...document.querySelectorAll("[role=menuitem], .menu button")].find((b) => b.textContent.trim().startsWith(label)).click();
    await this.until(() => [...document.querySelectorAll("main h1, main h2")].some((x) => x.textContent.trim() === label), 5000);
  },
  show(el, block = "center") { el.scrollIntoView({ block, behavior: "smooth" }); },
  // Workspace paths show the Windows user name: from now on, show the desktop app's default instead
  // (text and inputs, as they render).
  maskPaths() {
    const B = String.fromCharCode(92);
    const key = ":" + B + "Users" + B;
    const to = "%USERPROFILE%" + B + "MeritAI";
    const fix = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes(key)) n.nodeValue = to;
      document.querySelectorAll("input").forEach((i) => { if (i.value.includes(key)) i.value = to; });
    };
    fix();
    new MutationObserver(fix).observe(document.body, { subtree: true, childList: true, characterData: true });
    setInterval(fix, 100);
  },
  scrollBottom() { document.querySelectorAll(".thread, .dock-thread").forEach((t) => (t.scrollTop = t.scrollHeight)); },
  stubMic() {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); await ac.resume();
      const o = ac.createOscillator(); o.frequency.value = 220; const g = ac.createGain(); g.gain.value = 0; o.connect(g);
      const d = ac.createMediaStreamDestination(); g.connect(d); o.start();
      window.__speak = async () => { g.gain.value = 0.6; await new Promise((r) => setTimeout(r, 1200)); g.gain.value = 0; };
      return d.stream;
    };
  },
};
true;`;

async function open(u) {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(u);
  await sleep(2500);
  await win.webContents.executeJavaScript(HELPERS + "window.__h.maskPaths(); true;");
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { const h = window.__h; ${code} })()`);
async function shot(win, name) {
  // A hidden window can hand back its last frame: repaint first.
  win.webContents.invalidate();
  await sleep(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log("saved", name);
}

/** Records frames while `f` runs (up to 8 a second), with the time each one stays on screen. */
async function record(win, f) {
  fs.mkdirSync(FRAMES, { recursive: true });
  for (const x of fs.readdirSync(FRAMES)) fs.rmSync(path.join(FRAMES, x), { force: true });
  const times = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const t0 = Date.now();
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(FRAMES, `f${String(times.length).padStart(5, "0")}.png`), img.toPNG());
      times.push(t0);
      await sleep(Math.max(0, 125 - (Date.now() - t0)));
    }
  })();
  try {
    await f();
  } finally {
    on = false;
    await loop;
  }
  return times;
}

/** MP4 and GIF at real speed: the frames go through ffmpeg's concat list with their durations. */
function encode(times, name) {
  const list = path.join(FRAMES, "list.txt");
  const frame = (i) => `file 'f${String(i).padStart(5, "0")}.png'`;
  const lines = times.map((t, i) => `${frame(i)}\nduration ${(((times[i + 1] ?? t + 1500) - t) / 1000).toFixed(3)}`);
  fs.writeFileSync(list, [...lines, frame(times.length - 1)].join("\n") + "\n");
  const mp4 = path.join(OUT, `${name}.mp4`);
  const gif = path.join(OUT, `${name}.gif`);
  const input = ["-y", "-f", "concat", "-safe", "0", "-i", list];
  spawnSync("ffmpeg", [...input, "-vf", "fps=10,scale=1440:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", mp4], { stdio: "ignore" });
  spawnSync("ffmpeg", [...input, "-vf", "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5", gif], { stdio: "ignore" });
  const secs = ((times[times.length - 1] - times[0]) / 1000).toFixed(1);
  console.log("video", name, times.length, "frames", secs, "s", fs.existsSync(mp4) ? fs.statSync(mp4).size : 0, fs.existsSync(gif) ? fs.statSync(gif).size : 0);
}

// One GIF (and MP4) per feature for the product page (docs/index.html), in this order on one reseeded
// demo: --clips runs them all, --clips=screening,email only those.
const CLIPS = {
  // Confirm the drafted criteria, screen, decide.
  async screening(win) {
    await js(win, `h.nav("Hiring"); await h.sleep(1200); h.click("Weekend cleaner");`);
    await sleep(2000);
    await js(win, `h.show(h.btn("Yes, screen 5 applications"));`);
    await sleep(2500);
    await js(win, `h.click("Yes, screen 5 applications");`);
    await js(win, `await h.until(() => h.btn("Shortlist"), 60000);`);
    await sleep(1500);
    await js(win, `h.show(document.querySelector("main table") || h.btn("Shortlist"));`);
    await sleep(2500);
    // By row: a decision re-renders the table, so each click waits for the one before.
    for (const [who, choice] of [["Chloe Wu", "Shortlist"], ["Eli Moreau", "Shortlist"], ["Dev Patel", "Not this time"]]) {
      await js(win, `const row = [...document.querySelectorAll("main tr")].find((r) => r.textContent.includes("${who}"));
        [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "${choice}").click();`);
      await sleep(1800);
    }
    await sleep(2000);
  },
  // A role template, made yours, saved as a job with its job description.
  async "new-job"(win) {
    await js(win, `h.nav("Hiring"); await h.sleep(1200); h.click("New job");`);
    await sleep(2000);
    await js(win, `await h.until(() => document.getElementById("role-q"), 5000); await h.typeInto(document.getElementById("role-q"), "chef", 120);`);
    await sleep(1800);
    await js(win, `await h.typeInto(document.getElementById("role-q"), "clean", 120);`);
    await sleep(1500);
    await js(win, `const c = [...document.querySelectorAll(".role-card")].find((x) => x.textContent.startsWith("Cleaner")); c.click();`);
    await sleep(2000);
    await js(win, `const n = document.querySelector(".newjob-form input"); await h.typeInto(n, "Night cleaner (Parramatta)", 45);`);
    await sleep(600);
    await js(win, `const hrs = [...document.querySelectorAll(".newjob-form input")].find((i) => /Sat and Sun/.test(i.placeholder)); if (hrs) await h.typeInto(hrs, "Mon to Fri, 7 pm to 11 pm", 45);`);
    await sleep(2000);
    await js(win, `h.click("Create job");`);
    await sleep(3500);
  },
  // Asked from Staff: the side panel, one OK, the register behind it.
  async "side-panel"(win) {
    await js(win, `h.nav("Staff"); await h.sleep(1200); document.querySelector(".ask-btn").click(); await h.sleep(800); document.querySelector(".dock [aria-label='New conversation']").click();`);
    await sleep(1500);
    await js(win, `await h.say("dock-msg", "Priya is resigning, her last day is Friday 9 Oct", 40);`);
    await js(win, `await h.until(() => h.btn("Yes, save", document.querySelector(".dock")), 20000); await h.sleep(800);`);
    await js(win, `h.scrollBottom();`);
    await sleep(2000);
    await js(win, `h.click("Yes, save", document.querySelector(".dock"));`);
    await sleep(3000);
    await js(win, `h.scrollBottom();`);
    await sleep(3000);
  },
  after_side_panel: async (win) => {
    await js(win, `document.querySelector(".ask-btn").click();`);
    await sleep(800);
  },
  // What's due, worked out from the register; record the missing documents.
  async attention(win) {
    await js(win, `h.nav("Conversations"); await h.sleep(800); h.click("New"); await h.sleep(1000);`);
    await sleep(1000);
    await js(win, `await h.say("msg", "What do I need to do this week?", 45);`);
    await sleep(5000);
    await js(win, `h.click("Open employee");`);
    await sleep(3000);
    await js(win, `h.click("Record documents", document.querySelector(".drawer"));`);
    await sleep(2500);
    await js(win, `h.click("Record 3 documents");`);
    await sleep(3500);
  },
  after_attention: async (win) => {
    await js(win, `const x = [...document.querySelectorAll(".drawer .ib")].find((b) => b.getAttribute("aria-label") === "Close"); if (x) x.click();`);
    await sleep(800);
  },
  // Legal answers come from official sources; pay arithmetic is flagged.
  async "safe-answers"(win) {
    await js(win, `h.nav("Conversations"); await h.sleep(800); h.click("New");`);
    await sleep(1500);
    await js(win, `h.click("When is final pay due?");`);
    await sleep(6000);
    await js(win, `h.scrollBottom();`);
    await sleep(1500);
    await js(win, `await h.say("msg", "Can you calculate a Saturday shift?", 45);`);
    await sleep(4000);
    await js(win, `h.scrollBottom();`);
    await sleep(3500);
  },
  // An email drafted with its attachment, to send from the owner's own email app.
  async email(win) {
    await js(win, `h.nav("Conversations"); await h.sleep(800); h.click("New");`);
    await sleep(1500);
    await js(win, `await h.say("msg", "Email Priya the resignation acknowledgement, priya.nair@example.com", 35);`);
    await sleep(4500);
    await js(win, `h.scrollBottom();`);
    await sleep(2500);
    await js(win, `h.nav("Files"); await h.sleep(600); h.click("Outbox");`);
    await sleep(3500);
  },
  // Voice: the screen follows, and a change waits there for a spoken yes.
  async voice(win) {
    await js(win, `h.nav("Conversations"); await h.sleep(800); h.click("New"); await h.sleep(1000); h.stubMic(); document.querySelector("button.mic").click();`);
    await sleep(2500);
    await js(win, `await window.__speak();`);
    await sleep(6000);
    await js(win, `await window.__speak();`);
    await sleep(6000);
    await js(win, `await window.__speak();`);
    await sleep(5000);
    await js(win, `h.click("End voice");`);
    await sleep(2500);
  },
  // Coming soon: the tools it will connect to; voice usage in Settings.
  async connections(win) {
    await js(win, `h.nav("Connections");`);
    await sleep(2500);
    await js(win, `h.click("I want this");`);
    await sleep(1200);
    await js(win, `const b = [...document.querySelectorAll("main button")].filter((x) => x.textContent.trim() === "I want this"); h.show(b[3]); await h.sleep(1200); b[3].click();`);
    await sleep(2000);
    await js(win, `await h.settings();`);
    await sleep(2000);
    await js(win, `h.show(document.querySelector(".use"));`);
    await sleep(3000);
  },
  // 中文: the app and the replies in Chinese; documents stay in English.
  async chinese(win) {
    await js(win, `await h.settings();`);
    await sleep(1500);
    await js(win, `h.click("中文（简体）");`);
    await sleep(2500);
    await js(win, `h.nav("对话"); await h.sleep(500); h.click("新对话");`);
    await sleep(3000);
    await js(win, `h.nav("员工");`);
    await sleep(2500);
    await js(win, `h.nav("招聘"); await h.sleep(800); h.click("Team leader");`);
    await sleep(3000);
  },
  after_chinese: async (win) => {
    await js(win, `await h.settings("设置"); await h.sleep(1200); h.click("English");`);
    await sleep(1500);
  },
};

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const clipsArg = process.argv.find((a) => a.startsWith("--clips"));
  if (clipsArg) {
    const only = clipsArg.includes("=") ? clipsArg.split("=")[1].split(",") : null;
    try {
      const win = await open(url);
      await js(win, `localStorage.setItem("meritai.dock", "closed");`);
      await win.reload();
      await sleep(2500);
      await win.webContents.executeJavaScript(HELPERS + "window.__h.maskPaths(); true;");
      for (const [name, run] of Object.entries(CLIPS)) {
        if (name.startsWith("after_") || (only && !only.includes(name))) continue;
        try {
          encode(await record(win, async () => { await sleep(600); await run(win); }), name);
        } catch (e) {
          console.error("FAILED", name + ":", e.message);
        }
        const after = CLIPS["after_" + name.replace(/-/g, "_")];
        if (after) await after(win).catch(() => null);
      }
    } catch (e) {
      console.error("FAILED:", e.message);
    }
    return app.quit();
  }
  try {
    // ---- first run (a fresh workspace)
    if (firstRunOnly) {
      const w0 = await open(url);
      await shot(w0, "01-first-run.png");
      w0.destroy();
      return app.quit();
    }
    const win = await open(url);
    await js(win, `localStorage.setItem("meritai.dock", "closed");`);
    await win.reload();
    await sleep(2500);
    await win.webContents.executeJavaScript(HELPERS + "window.__h.maskPaths(); true;");

    // ---- Conversations
    await shot(win, "02-conversations.png");

    // ---- the video: a hire said in the chat reaches Staff and Hiring
    const frames = await record(win, async () => {
      await sleep(800);
      await js(win, `await h.say("msg", "Hannah Cole accepted the Team leader offer. She starts Monday 5 October, full-time.", 35);`);
      await sleep(2500);
      await js(win, `h.scrollBottom();`);
      await sleep(1200);
      await js(win, `h.click("Yes, save");`);
      await sleep(2500);
      await js(win, `h.scrollBottom();`);
      await sleep(2000);
      await js(win, `h.click("Open in Staff");`);
      await sleep(2500);
      await js(win, `const x = [...document.querySelectorAll(".drawer .ib")].find((b) => b.getAttribute("aria-label") === "Close"); if (x) x.click();`);
      await sleep(2000);
      await js(win, `h.nav("Hiring");`);
      await sleep(3000);
    });
    encode(frames, "hire-in-the-chat");

    // Stills of the same flow: back to the conversation for the cards.
    await js(win, `h.nav("Conversations");`);
    await sleep(1500);
    await js(win, `h.scrollBottom();`);
    await sleep(500);
    await shot(win, "03-what-changed.png");
    await js(win, `h.nav("Staff");`);
    await sleep(1500);
    await shot(win, "04-staff-updated.png");
    await js(win, `h.nav("Hiring");`);
    await sleep(2000);
    await shot(win, "05-hiring.png");

    // ---- the side panel next to Staff
    await js(win, `h.nav("Staff"); await h.sleep(1200); document.querySelector(".ask-btn").click(); await h.sleep(800); document.querySelector(".dock [aria-label='New conversation']").click();`);
    await sleep(1500);
    await js(win, `await h.say("dock-msg", "Priya is resigning, her last day is Friday 9 Oct", 20);`);
    await js(win, `await h.until(() => h.btn("Yes, save", document.querySelector(".dock")), 20000); await h.sleep(800);`);
    await js(win, `h.scrollBottom();`);
    await sleep(500);
    await shot(win, "06-side-panel.png");
    await js(win, `h.click("Yes, save", document.querySelector(".dock"));`);
    await sleep(3000);
    await js(win, `h.scrollBottom();`);
    await sleep(500);
    await shot(win, "07-side-panel-saved.png");
    await js(win, `document.querySelector(".ask-btn").click();`);
    await sleep(800);

    // ---- new job from a template
    await js(win, `h.nav("Hiring"); await h.sleep(1500); h.click("New job");`);
    await sleep(1500);
    await shot(win, "08-new-job-templates.png");
    await js(win, `const c = [...document.querySelectorAll(".role-card")].find((x) => x.textContent.startsWith("Cleaner")); c.click();`);
    await sleep(1500);
    await js(win, `const n = [...document.querySelectorAll(".newjob-form input")][0]; h.set(n, "Weekend cleaner (Parramatta)"); const hrs = [...document.querySelectorAll(".newjob-form input")].find((i) => /Sat and Sun/.test(i.placeholder)); if (hrs) h.set(hrs, "Sat and Sun, 6 am to 10 am");`);
    await sleep(800);
    await shot(win, "09-new-job-editor.png");
    await js(win, `const x = [...document.querySelectorAll(".newjob .ib")].find((b) => b.getAttribute("aria-label") === "Close"); if (x) x.click();`);
    await sleep(800);
    await js(win, `h.click("Advertise");`);
    await sleep(800);
    await shot(win, "10-advertise.png");
    await js(win, `document.querySelector(".fill")?.click();`);

    // ---- an email draft
    await js(win, `h.nav("Conversations"); await h.sleep(1000); h.click("New"); await h.sleep(1200); await h.say("msg", "Email Priya the resignation acknowledgement, priya.nair@example.com", 15);`);
    await sleep(4000);
    await js(win, `h.scrollBottom();`);
    await sleep(600);
    await shot(win, "11-email-draft.png");

    // ---- voice: the screen follows (a stand-in microphone; the demo's stand-in voice)
    await js(win, `h.click("New"); await h.sleep(1000); h.stubMic(); document.querySelector("button.mic").click();`);
    await sleep(2500);
    await js(win, `await window.__speak();`);
    await sleep(6000);
    await js(win, `await window.__speak();`);
    await sleep(5000);
    await shot(win, "12-voice-on-screen.png");
    await js(win, `await window.__speak();`);
    await sleep(5000);
    await shot(win, "13-voice-saved.png");
    await js(win, `h.click("End voice");`);
    await sleep(1500);

    // ---- Settings, Connections
    await js(win, `await h.settings();`);
    await sleep(1500);
    await shot(win, "14-settings-language.png");
    await js(win, `document.querySelector(".use").scrollIntoView({ block: "center" });`);
    await sleep(1200);
    await shot(win, "15-settings-voice-usage.png");
    await js(win, `h.nav("Connections");`);
    await sleep(1200);
    await shot(win, "16-connections.png");

    // ---- Chinese
    await js(win, `await h.settings(); await h.sleep(1200); h.click("中文（简体）");`);
    await sleep(2500);
    await js(win, `h.nav("员工");`);
    await sleep(1500);
    await shot(win, "17-chinese-staff.png");
    await js(win, `h.nav("招聘");`);
    await sleep(2000);
    await shot(win, "18-chinese-hiring.png");
  } catch (e) {
    console.error("FAILED:", e.message);
  }
  app.quit();
});
