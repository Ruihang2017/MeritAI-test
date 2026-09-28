# MeritAI alpha: tester guide

Thank you for testing MeritAI. It is an HR adviser for small business owners who have no HR department: they tell it what is happening, and it tells them what to do and helps with the paperwork. In this alpha you play a small business owner.

**This alpha focuses on hiring, onboarding and offboarding.** Try other things too if you like.

## 1 Rules for the alpha

- **Sample data only.** Use the made-up sample business, or a made-up business of your own. Never enter real employees, candidates or anyone's personal details. MeritAI runs on your personal ChatGPT sign-in, which is not a company-approved account.
- **Answers can be wrong.** It checks legal points against official Australian sources and shows them, but treat every answer as something to check. Nothing it drafts is sent anywhere: letters and emails are saved as files for you.
- **Tell us what you find.** Anything that confused you, was wrong, missing or slow is useful (section 6).

## 2 Before you start

| You need | Notes |
|---|---|
| A Windows 10 or 11 computer | About 1 GB of free space |
| A ChatGPT account whose plan includes Codex | You sign in with it once, in a browser. The adviser's usage counts against that account's plan |
| Optional, for voice: an OpenAI API key | Created at platform.openai.com (API keys), with billing set up. Separate from ChatGPT; voice costs about US$0.05 a minute, billed to that key's account |
| The installer | `MeritAI Setup 0.2.1.exe`, from the MeritAI test coordinator (Horace, ruihang2017@gmail.com) |

## 3 Install and first start

1. Run `MeritAI Setup 0.2.1.exe`. It installs for your Windows user only.
   - Windows may say "Windows protected your PC", because this test build isn't signed: choose **More info**, then **Run anyway**. Only do this for the installer you got from the test coordinator.
2. Open **MeritAI** from the Start menu.
3. **Sign in**: choose Sign in with ChatGPT, open the page it shows, sign in and enter the code. The app moves on by itself.
4. **Workspace**: keep the suggested folder (`C:\Users\<you>\MeritAI`) unless you have a reason not to.
5. **Your business**: choose **Try it with a sample business**. You are now Jo Kim, owner of *Wattle Lane Cleaning* (made up): 9 staff, 3 open jobs, some paperwork due. The app runs on the sample's date, 26 Sep 2026, so its reminders make sense. The **Sample data** label at the top lets you switch to your own (made-up) business later.

## 4 Getting around

- **Conversations**: talk to the adviser. Type, or drop files in. It asks before it saves anything to the staff register, a job or the business profile ("Needs your OK"); only a green receipt means something was saved. Under a reply, **What changed** shows the people and jobs it changed, with the next step; the pages update too, and a blue dot marks a page that changed while you were elsewhere.
- **Staff**: the staff register, with key dates and starting paperwork.
- **Hiring**: jobs, screening applications against criteria you confirm, your decisions, next steps.
- **Profile & policies**, **Files**: the business profile, policies, Inbox and Outbox.
- **Ask MeritAI** (top right, or Ctrl J): the side panel, so you can ask from any page without leaving it.
- **Connections** (marked Soon): what MeritAI will connect to later (email, job boards, payroll, backup). Press **I want this** on the ones you'd use.
- **Your name** (bottom left): Memory, Settings (including **Language · 语言**: English or Chinese) and **Send feedback**.
- **Voice** (optional): after adding your API key in Settings, press the microphone in Conversations and talk.

## 5 Tasks (sample business)

Do them in any order. For each, notice: did it tell you what to do, clearly and correctly? Did it do the work for you? Anything missing?

**Hiring**
1. Open Hiring › **Team leader**. Look at the ranking, open two candidates, decide who to shortlist, and mark the rest "Not this time".
2. From the next steps, make the **interview kit** and **draft the candidate emails**. Find the drafts in Files › Outbox.
3. **Weekend cleaner**: review the proposed criteria, change one, confirm, and screen the applications.
4. **Office admin** has no job description: write one with the adviser and save it into the job.
4b. **New job** › From a template: pick a role in your industry, make it yours, create it. Does the job description fit? Try "Create and ask MeritAI to tailor it".
5. Ask something you'd really wonder about, e.g. "What can't I ask in an interview?" or "Can I pay a trial shift?"

**Onboarding**
6. Hire someone from the Team leader shortlist: either Add to Staff on the Hiring page, or just tell the adviser ("Hannah accepted the offer, she starts Monday"). Check that Staff and the job both show it. Work through the new starter checklist: what must happen before day one?
6b. Ask the adviser to email the new starter their welcome or contract: it saves an email draft that opens in your email app (it never sends anything itself).
7. Marco's starting paperwork is overdue: find out what is missing and record what you've "done".
8. Ask: "I'm hiring a 16-year-old for weekends. What do I need to know?"

**Offboarding**
9. Priya is resigning (see Files › Inbox). Get the steps, draft the acknowledgement letter, and mark her as left.
10. Sam's fixed-term contract ends soon: extend it by 3 months. Did it explain the limits?
11. Ask how to handle an employee who hasn't turned up for a week.

**Your own made-up business** (optional)
12. Switch to your own business (the **Sample data** label › Switch to my own business), choose **Set up with the adviser**, and play this made-up owner: *Dan Kowalski, Ridgeline Plumbing, Geelong VIC, 6 staff including a second-year apprentice, weekly pay in MYOB, a member of a plumbing employers' association.* Then try: hiring an office administrator, or the apprentice wanting to leave.

**Voice** (optional, paid): ask a question out loud, then another while it is answering. Say someone was hired: the change waits on the right of the screen; say "yes" or press Yes, save. Settings shows what voice has cost (an estimate) and lets you set a monthly limit.

## 6 Giving feedback

- Under each answer: **Was this helpful?** Thumbs up, or thumbs down and say what went wrong.
- In **Connections**, press I want this on the connections you'd use: it goes in your feedback file.
- Any time: your name (bottom left) › **Send feedback**. Write what happened and tick what to include (your ratings, the current conversation, technical details). Your name is optional. It saves a file in `C:\Users\<you>\MeritAI\Feedback\`, then **Email it to the MeritAI team** opens an email with the file attached in your email app: check it and press Send. Using Teams instead? **Show in folder** and send the file to Horace (ruihang2017@gmail.com).
- Screenshots help too.

## 7 Known limitations

- English or Chinese (Settings › Language). In Chinese the adviser answers in Chinese, but letters, contracts, emails and job descriptions stay in English. Answers follow Australian employment law and official sources; they are not legal advice.
- MeritAI doesn't send email or post job ads yet: it saves drafts for you to send (Connections shows what's coming).
- From version 0.2.2, MeritAI updates itself: a new version downloads in the background, **Update ready** appears at the top, and it installs when you press **Restart to update** (or the next time you close MeritAI). Your conversations, settings and files stay. Earlier versions need the new installer once.
- Voice needs your own API key and costs money (Settings shows an estimate, and a monthly limit stops it). During voice, a change that needs your OK waits on the right of the screen: press Yes, save, or say "yes" (deleting always needs a press).
- The ChatGPT plan's usage can run out; the app says when, and when it resets.

## 8 Where your data is, and removing it

| What | Where |
|---|---|
| Your sign-in, memory, conversations, voice key (encrypted) | `%APPDATA%\MeritAI` |
| The workspace (Inbox, Outbox, Jobs, Policies, register) | `C:\Users\<you>\MeritAI` (and `MeritAI (sample)` for the sample business) |
| Feedback files | `C:\Users\<you>\MeritAI\Feedback` |

To remove MeritAI: Windows Settings › Apps › MeritAI › Uninstall, then delete the folders above if you want everything gone.

## 9 If something goes wrong

| Problem | Try |
|---|---|
| Sign-in doesn't finish | Keep the MeritAI window open while you sign in in the browser; if the code expired, choose Sign in again |
| "Usage limit reached" | The ChatGPT plan's usage ran out; it shows when it resets. Staff, Hiring, Files and forms still work |
| The microphone doesn't work | Settings › Voice: choose the microphone; check Windows › Privacy & security › Microphone allows desktop apps |
| Anything else | Send feedback with technical details ticked, and tell the test coordinator |
