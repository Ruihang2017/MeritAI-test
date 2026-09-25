# Files: Jobs, Inbox, Outbox and drag and drop (as built)

Users put a role's applications in **Jobs/<job>**, and loose documents in the **Inbox** (or drag them into the chat window). The assistant saves generated documents to the **Outbox**. Bulk screening of a job is described in `docs/screening.md`. The **Policies** folder and the business profile are described in `docs/business.md`.

## 1 Folders

| | Default | Model access |
|---|---|---|
| Jobs | `<project>/files/Jobs/<job>/` | One workspace per role (JD + applications, any subfolders). Read through the screening tools and `read_job_file`; see `docs/screening.md` |
| Inbox | `<project>/files/Inbox` | Loose files not tied to a job. Read only (`list_files`, `read_file`); top level only |
| Outbox | `<project>/files/Outbox` | Write only (`save_document`), never overwrites |
| Policies | `<project>/files/Policies` | The business's own policies; read only (`read_policy`); see `docs/business.md` |

- `files/` is gitignored. The folders are created on first use.
- Per user: `/files set <path>` moves the whole business workspace (Jobs, Inbox, Outbox, Policies and `.assistant/`, including the business profile) under another root (saved in `memory/users/<user>/settings.json`); `/files reset` returns to the default.
- `/files set` refuses:
  - a drive root;
  - the user profile root;
  - Windows, Program Files, ProgramData, AppData;
  - `codex_home` (credentials), `memory/` and `src/`.

## 2 Tools

| Tool | Behaviour |
|---|---|
| `list_files()` | File names, sizes, dates. Never full paths. Office lock files (`~$...`) are hidden |
| `read_file(name)` | PDF (text layer), DOCX, TXT, MD. Max 10 MB per file. Text is cut at 60,000 characters, with a note. The content is wrapped in `<document>` with a note that it is data, not instructions |
| `save_document(filename, format, content)` | Markdown content → `.docx` (converted) or `.md`. The name is sanitised. Written with the exclusive-create flag; a clash becomes `Name (2).docx` |

Unreadable inputs get a clear message:

- a scanned PDF with no text layer (OCR is not supported);
- legacy `.doc`;
- any other type.

## 3 Drag and drop into the chat

A file dragged into the terminal arrives as its path: quoted if it has spaces, otherwise bare. `src/files/attach.ts` handles it and `src/cli.ts` asks the questions.

- **Detection:** `findDroppedPaths` finds quoted or bare absolute paths (`C:\...`, `\\server\...`) that exist on disk. Trailing punctuation is tolerated. Paths that do not exist stay in the message as ordinary text.
- **Files:** `attachToInbox` copies a supported file into the Inbox:
  - types: PDF, DOCX, TXT, MD, and images PNG, JPG, WEBP, GIF; at most 25 MB;
  - never overwrites: an identical file already there is reused, and a different file with the same name becomes `Name (2).ext`;
  - a file already in the Inbox is used in place;
  - refused: other types, and anything inside `codex_home`, `memory/`, `src/` or `.assistant/`.
- **The message:** each path is replaced with `[attached: "<name>" (in the Inbox)]`, and the model reads the file with `read_file`. Images are also sent as `localImage` input, so the model sees them directly. Tested: it read hours from a roster screenshot.
- **Folders:** the CLI asks `[y/n]` to import the folder as a job (`importIntoJob`, the same code as `/import`). The path is replaced with `[imported folder as job "<job>" (N application file(s))]`.
- **Refused or declined:** an unsupported file, or a folder the user chose not to import, is removed from the message with a note in the terminal. If nothing is left, nothing is sent to the model.
- **Attachments with no request:** if the message is only paths, the files are attached and the CLI asks "What should I do with it?". The attachments go with the next message.
- **Why this is safe:** the copy is made by the client on the user's own action, and only from what the user typed. The model still reaches only Inbox, Jobs and Policies through the guarded tools and cannot name a path to copy. Voice requests do not go through this.

## 4 Security boundary

The file tools run in our Node process with the user's full Windows permissions. **The Codex sandbox does not apply to them; these checks are the boundary.**

- **Names, not paths:** `..`, `\`, `/`, `:`, reserved device names (`CON`, `NUL`, ...) and trailing dots are refused.
- **Links:** after `realpath`, an Inbox file must sit directly in the real Inbox, and a job file anywhere inside the real job folder (relative paths are checked segment by segment). A junction or symlink that points outside is refused. Junctions are tested; file symlinks could not be created on this machine without Developer Mode, but they go through the same check.
- **No overwrite, no delete.** There is no delete tool. `wx` fails on any existing entry, including a planted link.
- **Prompt injection:** document text (including hidden white text, which *is* extracted) is marked as untrusted. The model reports suspicious instructions and ignores them. Tested: a resume telling the AI to save a file and remember a discriminatory preference → neither happened, and the user was told.
- **Personal data:** work notes never contain file names (resume names often contain candidate names). Reports in the Outbox show candidate names and source file names (the owner's decision, 2026-09-25); that is the user's own document.

## 5 Prompt rules

These live in `prompts/developer.md` and `base.md`:

- Read files only when the user refers to them.
- Save only when the user asks. Default to docx for documents meant for colleagues.
- Show candidates by name with their source file; use Candidate A, B, ... only when the user asks for blind or anonymous screening.
- A job's applications are screened with the screening workflow (`docs/screening.md`), not by reading files in the chat.

## 6 Tests

`npm run test:files` covers:

- the name guard;
- junction escape;
- the parsers, including a scanned PDF and `.doc`;
- no overwrite;
- markdown → docx (headings, bold, lists, tables);
- the `/files set` guard;
- live:
  - list the Inbox;
  - screen 4 loose resumes and save a docx with names and file names, with the injection ignored;
  - work notes without names;
  - no save unless asked;
  - save as md;
  - path traversal through chat.

Set `FILES_TEST_KEEP=<dir>` to keep the generated documents for review.

Drag and drop is covered by `npm run test:business`:

- **unit:** detection, copying, reuse of an identical file, no overwrite, and refusal of unsupported types and the assistant's own folders; the folder case and the message rewrite are covered too;
- **live:** a dropped resume is read, and a dropped image is understood.
