# Plan: desktop UI design requirements

Status: **requirements confirmed; canvas built for review (37 artboards)** (owner, 2026-09-26). Design only. The design canvas is built from this document; the front-end stack and build come after the core evaluation. First canvas: https://claude.ai/artifact/G1g3P3WFcqGrJCYoNSwbA2 (private; direction approved, blue palette and more detail requested).

This document is the brief for the design canvas. Every screen lists its data source in the application layer (`src/app/app.ts`, see `docs/architecture.md`), so the design shows only what the core can produce. Items marked **[needs core]** are ideas that need new core work; design them as clearly optional.

## 1 Who it is for

- **Owner** of a small Australian business (5–30 staff) with no HR department. Busy, not an HR expert, often on a laptop between jobs. Wants to be told what to do and have the paperwork done.
- **Tester** in the Coates HR team playing an owner, with synthetic data only.
- Some owners write in Chinese: replies follow the user's language. The interface chrome is English for now; keep strings short so a translation fits (Chinese UI later, not in this round).

## 2 Principles

| # | Principle | What it means on screen |
|---|---|---|
| 1 | Tell them what to do, then do it | Answers lead with actions (checklists, next steps). Every card that needs action has one clear primary button |
| 2 | Code facts look different from model text | Confirmations, receipts, reminders, checklists and official sources come from code. They use cards and chips with fixed styling, never plain streamed text. Footer line: "Only a receipt means something was saved." |
| 3 | Nothing changes without a yes | Every write (profile, register, memory, folder import, criteria) is a confirm card with the exact changes. Destructive = red, explicit verb ("Delete"), never the default |
| 4 | Honest about limits | Pay arithmetic warning, unverified links, DRAFT banners on letters, "get advice" pointers, voice cannot confirm changes |
| 5 | Privacy is visible | "Sample data" marker while testing; the register states what it refuses to store; screening says it is blind |
| 6 | Plain language | No HR jargon without a one-line explanation. Dates as "Fri 2 Oct" (year only when not this year). Australian spelling |
| 7 | Calm | One accent colour. Red only for overdue or destructive. No gradients, no emoji, no mascots |

## 3 Visual language

Colour follows the blue reference screenshot (colour only; layout and type are ours).

| Token | Value | Use |
|---|---|---|
| `blue-600` (primary) | `#1A57CC` | Primary buttons, active nav text, links, focus ring |
| `blue-700` | `#1446A6` | Hover / pressed |
| `blue-100` | `#DCE6FA` | Active nav background, user message bubble |
| `blue-50` | `#EEF3FC` | Tool activity group, info banners, new-field highlight |
| `slate-200` | `#CBD4E1` | Workspace bar background |
| `ground` | `#EEF2F7` | Page background (deepened after the design review so white cards separate) |
| `surface` | `#FFFFFF` | Cards, panels, composer |
| `border` | `#D9DEE7` | Card and input borders |
| `divider` | `#E7EAF0` | Row separators |
| `ink` | `#1B1F27` | Body text |
| `ink-2` | `#4A5363` | Secondary text |
| `ink-3` | `#5F6878` | Captions (≥4.5:1 on white) |
| `red-700` / `red-50` | `#B3261E` / `#FCE8E6` | Overdue, destructive, error |
| `amber-800` / `amber-100` / `amber-300` | `#6B4E00` / `#FCEFC7` / `#F0D58A` | Due soon, needs your OK, gaps, warnings |
| `green-700` / `green-50` | `#1E6B3E` / `#E3F3E8` | Done, recorded, receipts, status OK dots |

- **Type:** one family, Public Sans (400/500/600/700); monospace IBM Plex Mono for paths and file names. Scale: 12 caption, 13 meta, 14 UI, 15 message body (line-height 1.55), 17 section, 20 page subtitle, 24 page title.
- **Spacing** 4 px base (4, 8, 12, 16, 20, 24, 32). **Radius** 8 inputs and chips, 12 cards, 16 composer and voice bar, 999 pills. **Elevation:** borders first; one soft shadow for the composer and floating menus only.
- **Icons:** outline, 1.75 px stroke, 18/20 px, Lucide style. Never emoji.
- **Status is never colour alone:** each status pill also has a word, and a dot or icon.
- **Accessibility:** WCAG 2.2 AA; targets ≥44 px (≥36 px for dense table actions); visible focus ring (2 px `blue-600`, 2 px offset); every action reachable by keyboard; streamed replies announced politely to screen readers.
- **Dark mode:** not in this round, but only use tokens so it can be added.

## 4 App shell

Minimum window 1024×700; designed at 1440×900; must also work at 1280×800.

```
┌ app bar: logo · business name · "Sample data" · workspace status pills ················ window ┐
├ nav 264 ┬ main (flex) ─────────────────────────────────────────────┬ attention 360 ─┤
│         │ page header: breadcrumb · title · status · actions       │  (collapsible) │
│         │ page content                                             │                │
└─────────┴──────────────────────────────────────────────────────────┴────────────────┘
```

- **App bar** (48 px, `slate-200`):
  - business name (from the profile; "Your business" before setup) and the "Sample data" pill;
  - status pills with a dot and a word: **Assistant** (Ready / Working / Not signed in: `account()`), **Speed** (Fast / Standard: the tier), **Workspace** (the files root folder name, full path in a tooltip: `folders()`).
- **Nav** (264 px, collapsible to 64 px icons):
  - primary "New conversation" button;
  - one list, no group headings (owner, 2026-09-26): Conversations, Staff, Hiring, Profile & policies, Files; a divider; Memory, Settings;
  - count badge on Conversations only when a confirm card is waiting; red badge on Staff when reminders are overdue;
  - **Recent**: the latest 5 conversations (title + relative time: `history()`), "All conversations";
  - footer: signed-in account line.
- **Attention panel** (360 px): reminders (§5.2). Shown on Conversations; other pages show an "Attention · N" button instead (Staff shows each person's next date in its table). Below 1280 px it becomes an overlay drawer.
- **Keyboard:** Ctrl+N new conversation, Ctrl+K quick switch (pages, employees, jobs, guides), Esc stops a running reply, Enter sends, Shift+Enter new line.

## 5 Screens

Each screen needs its **default, empty, loading and error** states in the canvas.

### 5.1 Conversation (home)

Data: `send()` events (`text_delta`, `text_done`, `tool_activity`, `skill_loaded`, `unverified_links`, `warning`, `error`, `turn_end`), confirm requests from `ui.confirm`, `history()`, `resume()`, `newConversation()`, `stop()`.

- **Header:** breadcrumb "Conversations › <title>", date started, actions: history, new conversation, more (rename, delete: [needs core]).
- **Day divider** between days.
- **User message:** right, `blue-100` bubble, meta "You · 9:12 am"; attached files as chips above the bubble ("Priya resignation.pdf · added to Inbox"); voice-sent messages show a mic icon ("You · said").
- **Assistant message:** left, avatar mark, meta "Adviser · 9:12 am" + the guide used (`skill_loaded`, e.g. "offboarding guide"). Markdown body: headings, numbered checklists, bold lead-ins, links. While streaming: a caret and a "Stop" button in the composer.
- **Tool activity group:** one collapsible row per answer, `blue-50`: "4 steps in this answer · 3 checked · 1 waiting on you". Expanded: one line per `tool_activity` summary with a status icon (done / running spinner / waiting / not saved). Running official-source searches say "Checking official sources (15–25 s)".
- **Official sources row:** chips with a shield icon, "Fair Work: Final pay". Only links a tool returned; others trigger the unverified-link banner.
- **Confirm card** (see §6.3): appears in place, below the text that asked for it; the composer stays usable but sending a new message while a card waits asks "Answer the card first?" ([needs app]: today the turn waits for the answer).
- **Receipt** after yes: green line with a check, "Saved to the employee register · Priya Nair: status left, 9 Oct", plus "Undo" only where the core supports it (not in this round: show no Undo).
- **File card** when `tool_activity.files` is present: name, folder ("Outbox"), Open, Show in folder.
- **Warnings:** pay calculation banner under the message; unverified links banner listing the URLs.
- **Composer:** multi-line input, placeholder "Tell me what happened, or ask what to do next"; buttons: attach, Guides (skill picker: the 11 guides with one-line descriptions: `skills()`), mic (starts voice), send / stop. Pending attachment chips with remove. Footer: "Replies can be wrong. Only a receipt means something was saved."
- **Suggested next step chip** in the composer ([needs core]: the model would have to return a structured suggestion; design it as optional).
- **Empty state** (new conversation): greeting with the business name, 4 starter cards based on data: "2 reminders need attention", "Hire someone", "Someone is leaving", "A difficult conversation"; each sends a prefilled message.
- **Drop overlay** over the whole main area: "Drop to add to your Inbox. A folder of applications can become a job."

### 5.2 Attention (reminders)

Data: `reminders()` → `{due, overdue, title, detail, employeeId, source}`, computed on every open (30-day horizon plus everything overdue). Kinds today:
- starting paperwork not recorded;
- probation ends;
- visa or work rights expire;
- fixed-term contract ends;
- give the Casual Employment Information Statement again;
- casual can ask to become permanent;
- new minimum wages from 1 July.

- Header "Attention" + red count of overdue, amber count of due within 7 days.
- Filters: Overdue · This week · This month (all within the 30-day horizon).
- **Card:** status line ("OVERDUE 3 DAYS" red / "DUE FRI 2 OCT" amber / "31 OCT" neutral), title, detail (2 lines, expand), source chip (official page), actions: **Ask about this** (starts a conversation with the reminder text), **Open employee** (when `employeeId`).
- Snooze / Resolve: [needs core] (reminders are computed, nothing is stored). Show them in a separate "future" variant only.
- Footnote: "Reminders are worked out from your register and business profile each time. Rules checked on 25 Sep 2026."
- Empty: "Nothing due in the next 30 days."

### 5.3 Staff (employee register)

Data: `staff(includeLeft)` → name, role, employmentType, startDate, endDate, probationEnd, award, classification, visaExpiry, status, leftDate, notes, documents[{id, date}]; expected documents per employee (contract, FWIS, CEIS for casuals, FTCIS for fixed-term, TFN, super choice, VEVO when a visa expiry is set, induction).

- Header: "Staff", counts "9 active · 2 left", search, filter by type, "Show people who have left", **Add employee**.
- Table: name, role, type, started, next date (the nearest reminder for that person), starting documents (pill "All recorded" green / "3 not recorded" amber), row menu.
- **Detail drawer** (440 px): name, role, type, dates; **Starting documents** list with "recorded 6 Sep" or "not recorded yet" + the timing rule; **Work details** (award, classification, probation, end date, visa expiry, notes); reminders for this person; actions: Record documents, Edit details, Mark as left, Ask the adviser. Delete is in the overflow menu, destructive.
- **Direct forms (agreed 2026-09-26; built in `AssistantApp`, branch `app/ui-ready`):** Add employee, Edit details, Record documents (checkboxes with a date) and Mark as left are forms. They call the same core functions as the chat tools, so the same validation and PII refusal apply. Submitting the form is the confirmation (no second yes/no), except Delete, which keeps the destructive confirm. After saving: a receipt plus the same code notes the tools give (leaving checklist when marked as left, the fixed-term limits note when an end date changes) and "Ask the adviser about this". The chat path stays: "Add Sam, starts Monday, casual" still works through the tools and confirm cards.
- Why forms: register data is structured and entered in bulk (e.g. 9 staff at setup, ticking documents); a form is faster, uses no model quota and cannot be misread by the model. The adviser still reads the register fresh each time, so both paths stay in sync.
- Privacy line: "The register holds work details only. TFNs, bank details, dates of birth, home addresses and health information are refused."
- Leaving flow: when marked as left, the receipt is followed by the leaving checklist card (from code).
- Empty: "No one in the register yet. Add your first employee, or tell the adviser about your team."

### 5.4 Hiring (jobs and screening)

Data: `jobs()` → job, files, criteria status; `importJob()`; `screen(job)` → `no-jd` / `not-confirmed` / `done` + summary; screening results (`RankedCandidate`: rank, name, file, band Strong / Partial / Weak / Not a resume, essential and desirable scores, evaluation with per-criterion met / partly / not evidenced + evidence, strengths, gaps, interview questions, flags); `report(job, docx | xlsx)`.

- **Jobs list:** each job with its step and counts ("14 applications · screened", "criteria to confirm"); drop zone "Drop a folder with the job description and applications".
- **Job page stepper:** 1 Job description (found / missing: "Add a file with JD in its name") → 2 Criteria (confirm card, kind `criteria`: essential and desirable lists) → 3 Screening (progress: "Screening 8 of 14", up to 20 per run, "6 remaining: run again") → 4 Your decision.
- **Ingest summary:** new, unreadable (with reason), duplicates (same as …).
- **Results table:** rank, name, band pill, essentials "3 of 3" (half points shown as "2.5 of 3"), desirables, one-line summary, flags icon (suspicious instructions in the file / applied for a different role).
- **Candidate drawer:** per-criterion status with evidence quotes, strengths, gaps, suggested interview questions, flags explained, "Open the application".
- **Banner:** "Blind screening: assessed without names, photos, ages or addresses, against your criteria only. The ranking is a starting point; the decision is yours."
- **Actions:** Word report (top 10, default), Excel (everyone), Draft candidate emails (starts a conversation with the candidate-email guide), Interview kit.
- States: no JD, criteria not confirmed, partially screened, failed files.

### 5.5 Business profile and policies

Data: `profile()` → fields (legal name, trading name, ABN, industry, states, address, headcount, employment types, awards, pay frequency, payroll system, benefits and rules, signer, adviser {kind, name, contact}, EAP, notes, updatedAt), the rendered lines (incl. small business status and the adviser note), `Policies/` list.

- Two columns: **Profile** (grouped: Business, People, Pay, Advice and support) and **Policies** (file list with type and date, "Add a policy": drop or choose; opens the Policies folder).
- Unset fields show "Not set yet" + "Tell the adviser". Editing: an Edit form per group (same pattern and reasoning as the register forms, [needs app]), or through the conversation (confirm card, kind `profile`).
- Derived facts in a highlighted box: small business employer yes/no/unknown with the counting rule; adviser note (an accountant is for payroll, tax and super only).
- Completeness meter ("9 of 15 filled").

### 5.6 Files

Data: `files()` → folders (root, Inbox, Outbox, Jobs, Policies) and Inbox entries.

- Tabs: Inbox (what you gave the adviser), Outbox (what it wrote: never overwritten), Jobs, Policies. Each file: name, type icon, size, date, Open, Show in folder.
- Workspace folder line with "Change folder" (Settings).
- Empty Outbox: "Letters and documents the adviser saves appear here."

### 5.7 Memory

Data: `memories()` → preferences (text, explicit / proposed, date), task notes (text, expires); `forget(id)`.

- Two lists: **Preferences** ("Sign letters as Jo Kim, Director") and **Recent work notes** (expire after 30 days, show "expires 26 Oct").
- Each item: Forget (confirm). Explainer: "The adviser remembers preferences you approve. It never stores candidate or employee personal details here."

### 5.8 Settings

Data: `account()`, `login()`, `setTier()`, `setFilesRoot()` / `resetFilesRoot()`, `microphones()` / `setMicrophone()`.

- **Account:** signed-in line, sign in / out (the login prompt shows a code and link).
- **Speed:** Fast / Standard, with the one-line trade-off.
- **Workspace folder:** path, change, reset to default.
- **Voice:** microphone, "about US$0.05 a minute, billed to the voice API key", "stops after 60 s of silence".
- **About:** model, version, "Sample data only while signed in to a personal account".

### 5.9 First run

1. **Sign in** (ChatGPT account) with a short explanation.
2. **Workspace:** default folder or choose one; explains Inbox / Outbox.
3. **Business setup conversation** (`setup()`): chat on the left, the profile filling in on the right with new fields highlighted, confirm card (kind `setup` / `profile`). "Skip for now" is always available; skipping shows a setup banner on the conversation page.

### 5.10 Voice mode

Data: `startVoice()` handlers: `onRequest` (text sent, new or steer), `onEvent`, `onSaid`, `onConfirmSkipped`, `onError`, `onEnded({reason, byUser, billedSeconds})`.

- The composer turns into a **voice bar** (`blue-600` background): live orb with states Listening / Thinking / Speaking / Working on "<tool>", the last caption, microphone picker, elapsed time, cost line, Mute, **End voice**.
- Spoken requests appear as user messages with a mic icon; "steer" requests show "added to the current task".
- **Skipped confirmations:** voice cannot answer confirm cards, so they are declined and shown as amber cards "Not saved during voice" with "Review and save" (starts the same change as a normal confirm card).
- **End summary:** "Voice ended after 2:14 (about US$0.11)", reason (you ended it / 60 s of silence / error).

### 5.11 Conversations list

Data: `history()` → title, started; `resume(record)`.

- List grouped by Today / This week / Earlier, search by title, open. Kept for 30 days (say so).

## 6 Components

| Component | Variants and states |
|---|---|
| **6.1 Message** | user, user (voice), assistant streaming, assistant done, assistant stopped ("Stopped"), assistant failed (with Try again) |
| **6.2 Tool activity group** | collapsed / expanded; step states: done, running, waiting on you, not saved (declined), failed |
| **6.3 Confirm card** | kinds: profile, register, memory, folder-import, criteria, setup; `destructive`; states: waiting, saved (receipt), not saved, skipped in voice, expired (the reply was stopped) |
| **6.4 Receipt** | saved to profile / register / memory; imported job; file saved |
| **6.5 Source chip** | official (shield); hover shows the full URL |
| **6.6 Banners** | pay calculation (amber), unverified links (amber, lists URLs), DRAFT letter note (neutral), setup incomplete (blue), sample data (amber pill), error (red, with retry) |
| **6.7 File card and attachment chip** | attached, reused ("already in Inbox"), image, refused (with reason), import offered |
| **6.8 Reminder card** | overdue, due this week, later; with and without employee; with source |
| **6.9 Status pill** | dot + word: Ready, Working, Signed out, Fast, Standard |
| **6.10 Band pill** | Strong, Partial, Weak, Not a resume |
| **6.11 Document status** | recorded (date), not recorded yet (timing rule), not needed |
| **6.12 Empty states** | one per page, with one action |

## 7 Copy rules

- Speak as "I" (the adviser) in messages and "you" to the owner. Short sentences.
- Buttons are verbs: "Yes, save", "Record documents", "End voice". Never "OK" or "Submit".
- Fixed wording (from code, keep exact): confirm titles ("Save to the business profile?", "Update Priya Nair in the employee register?", "Remember this for future conversations?"), reminder titles, document names ("Fair Work Information Statement given").
- Legal cues: "Check with your adviser or an employment lawyer" on letters about decisions; "I don't work out pay amounts" with the Pay and Conditions Tool link.
- Synthetic data: names and businesses in the canvas are fictional (Wattle Lane Cleaning, NSW, 9 staff) and the canvas is marked "Sample data".

## 8 Canvas deliverables (what /design produces)

| Round | Artboards (1440×900 unless noted) |
|---|---|
| **1: foundations** | Tokens and type sheet; component sheet (§6, all variants); app shell (nav expanded / collapsed, attention open / closed) |
| **2: core flow** | Conversation: empty state, streaming, answer with tools + sources + confirm, receipt + file card, warnings, error; Attention panel states; drop overlay |
| **3: work pages** | Staff list + detail drawer + empty; Hiring: jobs, criteria confirm, screening in progress, results, candidate drawer, no JD |
| **4: the rest** | Profile & policies; Files; Memory; Settings; First run (3 steps); Voice (listening, working, skipped confirm, ended); Conversations list; 1280×800 variant of the conversation |

Each artboard is named "<page> · <state>". Clickable prototype links between pages. [needs core] items appear only on a separate "Later" row.

## 9 Out of scope for this round

Mobile layouts, dark mode, Chinese interface chrome, multi-business switching, notifications, Undo, reminder snooze or resolve, conversation rename or delete.

## 10 Owner decisions (2026-09-26)

1. Product name: **MeritAI** (app bar, window title, avatar mark "M"; the assistant is still referred to as "the adviser" in copy).
2. Direct register and profile forms: **agreed** (owner, 2026-09-26) and designed as the main path. Built in the application layer on branch `app/ui-ready` (`addEmployee`, `updateEmployee`, `recordDocuments`, `markLeft`, `removeEmployee`, `updateProfile`; see `docs/architecture.md` there).
3. Hiring shows **candidate names** by default (current behaviour); Candidate A/B/C only on request.
4. The canvas is built in one pass (all four rounds of §8) and reviewed together.

## 11 Design review and rules added (2026-09-26)

The canvas was reviewed by an independent reviewer (all boards rendered and checked, text contrast checked by script). Fixes made and the rules they set:

| Rule | Detail |
|---|---|
| Layers, not decoration | Ground `#EEF2F7`; nav and Attention panel on `#FAFBFD` with a 1 px border; cards, composer and drawers white; each page header is a white band with a soft edge. A fine dot grid (1 px, 24 px apart) only where there is no work: the new-conversation greeting, first run, empty states and the drop overlay. No photos or illustrations behind working content |
| Targets | Buttons 44 px, dense actions 36 px, icon buttons 44 px |
| Attention button | Every page without the panel shows "Attention · 1 overdue · 1 this week" in the app bar (not in page headers); the panel as a drawer has a close button; its footnote is pinned |
| Names | MeritAI is the product and the sender name on messages; in copy the assistant is "the adviser"; the app bar pill reads "Adviser: Ready / Working / Offline / Not signed in / Usage limit until …" |
| Dates | The UI reformats every `YYYY-MM-DD` it receives (confirm items, receipts, tool summaries, reminder titles) as "Fri 9 Oct", with the year only when it is not this year |
| Button order | The action first, the safe answer next to it (as on confirm cards); destructive actions red; "Mark as left instead" as a separate text action |
| Colour | Red only for overdue, destructive and errors; "needs a job description" and similar are amber |
| First run | App bar shows only the logo, "Your business", sample data and sign-in state; the nav hides Recent |
| Recent | 3 conversations in the nav (height), all in Conversations |

New states drawn after the review: usage limit (full page) and "when the adviser can't answer" (limit, not starting, sign-in expired, what still works), sending while a card waits, guides menu, conversation menu, quick switch, Attention drawer, staff row menu / edit / delete / after adding / after recording / people who left / loading, hiring new job / more to screen / report saved / flagged candidate, files Inbox, voice states, dialogs, empty and error states.

Needs app or core work, shown on the canvas as designed but not built yet: voice Mute (the voice API has only stop), the usage-limit reset time (shown only if the engine reports it), reformatting dates on the client, register write forms (built on 2026-09-26), everything on the Later board.
