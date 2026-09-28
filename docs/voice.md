# Voice mode (as built)

`/voice` in the CLI: speak instead of typing, hear the answer, and interrupt it by speaking. GPT-Live handles the voice. The thinking stays in the Codex HR assistant (prompts, skills, business profile and policies, memory, files, official sources, guards).

## 1 Flow

```
mic ─ffmpeg(dshow, PCM16 24 kHz)→ session.input_audio.append ─→ GPT-Live (gpt-live-1, voice gleam, delegation: client)
                                                                   │ small talk: answers by itself
                                                                   │ everything else: session.delegation.created {id}
                                                                   ▼
                                  VoiceBridge: user text = input transcript since the last request
                                     no turn running → engine.send()   (same Codex thread as typed chat)
                                     turn running    → engine.steer()  (base.md decides: add to or replace the task)
                                     Codex progress  → session.thinking.append (quiet)
                                     official-source research → commentary "checking government sources, ~20 s"
                                     final answer    → session.commentary.append (a speakable summary, same delegation id)
                                                                   ▼
speaker ←ffplay(low latency)─ session.output_audio.delta ── GPT-Live says 2-4 sentences; full answer on screen
```

Code:

| File | Responsibility |
|---|---|
| `src/voice/liveSession.ts` | WebSocket client |
| `src/voice/bridge.ts` | Delegation → Codex |
| `src/voice/audio.ts` | ffmpeg / ffplay |
| `prompts/voice.md` | GPT-Live persona |
| `src/cli.ts` | `/voice`, `/voice device` |

## 2 API facts (verified 2026-09-25, not guessed)

| Item | Value |
|---|---|
| Endpoint | `wss://api.openai.com/v1/live/sessions` (the model's only endpoint). No query parameters; `/v1/realtime` rejects `gpt-live-1` |
| Auth | `Authorization: Bearer <key>`: the key saved in Settings (`src/voice/keyStore.ts`: DPAPI-encrypted for the Windows user, only its last 4 characters ever shown, checked with OpenAI before saving), else `VOICE_OPENAI_API_KEY` in `.env`. Never an environment variable named `OPENAI_API_KEY` (codex would read it) |
| First event | `session.start` with `session: {model, instructions, audio: {format: {type: "audio/pcm", rate: 24000}, output: {voice}}, delegation: {type: "client"}}` → `session.started` |
| Audio | PCM16 mono 24 kHz base64. Output is a continuous real-time stream (about one 100 ms delta per 100 ms, silence included), field `delta` |
| Delegation | `session.delegation.created` has only `delegation.id` and `offset_ms`; **no text**. The request comes from `session.input_transcript.delta` (`start_ms`/`end_ms`) |
| Results | `session.commentary.append {delegation_id, content}` (spoken, paraphrased, ≤ 500 tokens); `session.thinking.append` (quiet). **There is no completion or cancel event** |
| Price | US$0.05 per minute, billed per second (model page). The CLI prints the seconds the API reports when voice stops; silence appears not to be billed |

Deviation from the plan: there is no cancel event, so "stop" or "never mind" arrive as a new delegation. The bridge steers them into the running turn, and the `base.md` rule for messages that arrive mid-turn drops the old task.

## 3 Behaviour details

- **Same conversation:** voice and text share the Codex thread. `/history`, work notes and memory work unchanged, and voice requests are recorded like typed ones.
- **Screen and speech:** the Codex answer streams on screen in full (sources, lists, link warnings). GPT-Live speaks a summary and does not read URLs or markdown (`speakable()` strips them before sending).
- **Which words are the request (`selectUtterance`):** the unconsumed input-transcript words, split into utterances only where the user paused (≥ 700 ms) **and** GPT-Live spoke in that pause. The last utterance is the request. All times are on the session timeline (`start_ms`/`end_ms`).
  - Small talk the voice already answered is dropped.
  - A barge-in ("actually, never mind, ...", spoken over the voice) is kept whole.
  - A user pausing mid-sentence while the voice is quiet is kept whole.

  Two earlier versions each failed a case caught by `test:voice`:
  - marking words as handled whenever the voice spoke lost the request;
  - "words after the voice last stopped" cut the start of a barge-in.

  Unit tests cover all three cases.
- **Speaking results:** the commentary asks GPT-Live to say the key facts (figures, durations, amounts) first and mention the screen only for extra detail. In testing it once answered "it's on your screen" without the facts; the prompt now forbids that.
- **Figures must be said exactly:** in one test run GPT-Live said "a five hundred dollar bonus" for a $1,500 answer. Both the commentary and `voice.md` now require numbers, amounts, dates and durations to be said exactly as written, and 3 consecutive runs passed after that. This remains the main voice risk, because GPT-Live paraphrases. The full, correct answer is always on screen, and the voice test logs the assistant's text next to what was spoken.
- **Cancelling while the assistant works:** GPT-Live sometimes acknowledges "never mind" itself, and the next request ("tell me X instead") is steered in. `voice.md` also asks it to delegate a bare cancellation, so the assistant stops the old task.
- **Steering:** if a steer is impossible (the turn is just starting or ending), the request is queued and run right after.
- **Idle auto-stop:** voice stops by itself after 60 s (`FX_VOICE_IDLE_SECONDS`) with no speech from the user or the voice while the assistant is not working, so a forgotten session does not keep streaming the microphone. The prompt returns without pressing Enter.
- **Billing (observed, not documented):** the API reports billed seconds when the session closes. A 12 s silent session was billed 0 s, and a 25 s session with about 9 s of speech was billed 9 s, so silence appears not to be billed but anything the mic picks up may be.
- **Confirmations:** in the terminal they need a keyboard `[y/n]`, so in its voice mode they are not saved and a note says so (type the request again after voice mode). In the browser (2026-09-27) they wait on screen (`startVoice(…, { confirmOnScreen: true })`): the app tells the voice to ask for the OK (`VoiceBridge.say`), and while a question is open a short spoken answer ("yes", "yeah, save it", "no") answers the latest one instead of being steered into the task (`AssistantApp.answerSpoken`, `PendingConfirms.answer`; the page's copy closes as answered). Deleting always needs a press. Voice's own work runs outside the request that started it, so its questions and changes belong to the voice reply.
- **Echo:** with laptop speakers and the built-in mic, the model can hear itself and treat it as barge-in. Use headphones.

- **Usage and a monthly limit** (2026-09-27): when a call ends its billed seconds are added to `voice-usage.jsonl` in the user's memory folder (the stand-in voice isn't counted); Settings shows today, this month and all time at US$0.05 a minute. With a monthly limit set (`voiceMonthlyLimitUsd`), a call can't start once the month's estimate reaches it, and a running call stops when it does.

## 4 Security and privacy

- Audio and transcripts, plus the answer summaries we send as commentary, go to the OpenAI organisation of the voice key. Use a company key before any real data.
- GPT-Live has no tools of its own. Files, memory, the web and skills stay behind Codex and our guards.
- The key is in `.env` (gitignored). It is not named `OPENAI_API_KEY`, which would switch the Codex login to API billing.

## 5 In the browser

The browser UI passes its own `audio` to `startVoice`: the page's microphone (PCM16 mono 24 kHz, 100 ms chunks through the WebSocket, `voiceAudio`) and its speaker (the output audio sent back only to that page). Mute sends silence. Voice starts from Conversations or from the side panel on any page (the page stays; questions say what they are about, `ConfirmRequest.about`, so the page can highlight it). See `docs/ui.md` (Voice). With the demo engine, `src/voice/fakeLive.ts` stands in for GPT-Live (no key, no cost): it streams silence, "hears" a scripted request after about a second of speech and a pause, and speaks a demo line as a soft tone.

## 6 Tests

`npm run test:voice` needs the key, ffmpeg and the Windows voices Zira + Huihui. A synthetic mic streams Windows-TTS questions and then silence, in real time. Checks:

- small talk is not delegated;
- an English parental-leave question is delegated to Codex and the knowledge answer is spoken;
- a follow-up stays in the same Codex thread (probation, 6 months);
- interrupting while the assistant is still researching ("what's the minimum wage?" → "never mind, tell me the referral bonus") → steered into the running turn and the new answer is spoken ($1,500);
- a Mandarin question gives a spoken Chinese answer (wellness day: one day).

Passed 3 runs in a row on 2026-09-25, and 1 run after the small-business prompt change the same night (123 s billed, about US$0.10; the test now uses the synthetic test business). The live session is stopped cleanly; late errors from a closing session are ignored.

Live-mic behaviour (barge-in, echo, device choice) needs a person; see `docs/manual-test.md`.
