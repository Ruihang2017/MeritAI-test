// Screenshots and a short video of MeritAI for the README (docs/images/), from the demo (the synthetic
// sample business, fake engine: no model, no cost). Electron opens the page off-screen, clicks through
// the flows and saves PNGs; the video's frames go through ffmpeg (MP4 and GIF).
//
//   npm run ui:fake -- --demo-dir shots --reseed --no-open --port 5190      (and, for the first-run
//   screen, a second one with --fresh on 5191), then (electron.exe directly: npx hides its output):
//   node_modules/electron/dist/electron.exe scripts/docs-media.cjs <url of 5190>
//   node_modules/electron/dist/electron.exe scripts/docs-media.cjs <url of 5191> --first-run
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const url = process.argv.slice(2).find((a) => a.startsWith("http"));
// --first-run: only the first-run screen (a server started with --fresh).
const firstRunOnly = process.argv.includes("--first-run");
const OUT = path.join(__dirname, "..", "docs", "images");
const FRAMES = path.join(require("os").tmpdir(), "meritai-frames");
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
  await win.webContents.executeJavaScript(HELPERS);
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(`(async () => { const h = window.__h; ${code} })()`);
async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log("saved", name);
}

/** Records frames while `f` runs (about 8 a second). */
async function record(win, f) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  let n = 0;
  let on = true;
  const loop = (async () => {
    while (on) {
      const t0 = Date.now();
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(FRAMES, `f${String(n++).padStart(5, "0")}.png`), img.toPNG());
      await sleep(Math.max(0, 125 - (Date.now() - t0)));
    }
  })();
  await f();
  on = false;
  await loop;
  return n;
}

function encode(frames, name) {
  const fps = 8;
  const mp4 = path.join(OUT, `${name}.mp4`);
  const gif = path.join(OUT, `${name}.gif`);
  const input = ["-y", "-framerate", String(fps), "-i", path.join(FRAMES, "f%05d.png")];
  spawnSync("ffmpeg", [...input, "-vf", "scale=1440:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", mp4], { stdio: "ignore" });
  spawnSync("ffmpeg", [...input, "-vf", "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5", gif], { stdio: "ignore" });
  console.log("video", name, frames, "frames", fs.existsSync(mp4) ? fs.statSync(mp4).size : 0, fs.existsSync(gif) ? fs.statSync(gif).size : 0);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
    await win.webContents.executeJavaScript(HELPERS);

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
    await sleep(4500);
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
    await js(win, `h.nav("Conversations"); await h.sleep(1000); await h.say("msg", "Email Priya the resignation acknowledgement, priya.nair@example.com", 15);`);
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
    await js(win, `document.querySelector(".me, .me-icon").click(); await h.sleep(500); h.click("Settings");`);
    await sleep(1500);
    await shot(win, "14-settings-language.png");
    await js(win, `document.querySelector(".use").scrollIntoView({ block: "center" });`);
    await sleep(1200);
    await shot(win, "15-settings-voice-usage.png");
    await js(win, `h.nav("Connections");`);
    await sleep(1200);
    await shot(win, "16-connections.png");

    // ---- Chinese
    await js(win, `document.querySelector(".me, .me-icon").click(); await h.sleep(500); h.click("Settings"); await h.sleep(1200); h.click("中文（简体）");`);
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
