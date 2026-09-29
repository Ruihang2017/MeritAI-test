# Alpha 发出前的整体测试（给项目负责人）

从上到下做一遍，每步对照"预期"。有问题记下步骤号和截图；也可以在 app 里用 Send feedback 存一个文件发给开发。

全部用示例企业或虚构数据。A–H 大约 60 分钟，J–R 大约 45 分钟，S（0.2.2 的新内容）大约 15 分钟；语音（第 F 步）另算，真实语音约 US$0.05/分钟。

## 0 准备

- 先停掉旧的 `npm run ui:demo` / `ui:fake` 窗口（它们用的是旧代码）。
- 桌面程序的登录、memory 和语音 key 都在 `%APPDATA%\MeritAI`，和项目里的是分开的，所以要**重新登录一次**。
- 准备一个 OpenAI API key（第 E、F 步用，**不要**用 `OPENAI_API_KEY` 那个），再准备一个故意写错的 key，比如 `sk-test123456789012345`。
- 屏幕宽度大于 1280 像素（第 C 步要把窗口拉宽再拉窄）。

## A 安装和第一次启动（10 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| A0 | 电脑上装着 0.2.1 的话，先按第 I 步卸载并清理（这样才能测首次运行）；不想从头测，也可以直接装 0.2.2 覆盖，登录和数据都保留，跳到 A5 之后 | 开始菜单里没有 MeritAI，或者保留了旧版 |
| A1 | 运行 `release\MeritAI-Setup-0.2.2.exe`（或从 GitHub 的 0.2.2 草稿下载同名文件） | 可能弹出 SmartScreen 警告（没有签名），点 More info › Run anyway；装到当前用户下，开始菜单出现 MeritAI |
| A2 | 从开始菜单打开 MeritAI | 一个窗口，标题 MeritAI；出现首次运行的登录页 |
| A3a | 点 Sign in with ChatGPT，出现代码后点等待栏右边的 **Cancel** | 回到 "Sign in with ChatGPT" 按钮，**没有**报错 |
| A3 | 再点 Sign in with ChatGPT → 在浏览器里登录并输入代码 | 回到 app 后自动进入下一步，**不用**手动刷新 |
| A4 | 工作区保留默认的 `C:\Users\<你>\MeritAI` | 下一步是选企业 |
| A5 | 选 **Try it with a sample business** | 进入 Wattle Lane Cleaning：9 名员工、3 个在招职位；顶部显示 **Sample data**；日期按 2026-09-26 算（提醒是合理的） |
| A6 | 任务管理器 › 详细信息 | 运行的是 `…\MeritAI\resources\codex\bin\codex.exe`，**不是**你自己装的 Codex |
| A7 | 关闭窗口再打开 | 直接进入，不再登录；再点一次开始菜单只会切到已经打开的窗口（单实例） |

## B 示例企业：招聘、入职、离职（25 分钟）

按 `docs/alpha/tester-guide.md` 第 5 节的任务 1–11 做。重点看：

| # | 任务 | 预期 |
|---|---|---|
| B1 | Hiring › Team leader：看排名，决定 Shortlist / Not this time | 决定马上显示；数字（shortlisted / undecided）会跟着变 |
| B2 | 生成 interview kit、candidate emails | Files › Outbox 里有草稿；邮件**不会**被发出 |
| B3 | Weekend cleaner：改一条标准 → 确认 → 筛选 | 先确认标准才开始筛；有进度 |
| B4 | Office admin：跟 AI 写 JD | 保存到 Jobs/Office admin 或 Outbox |
| B6 | 从 Team leader 的 shortlist 里 Add to Staff | 跳到 Staff 的新增表单，姓名和职位已经填好；保存后出现 new starter checklist，职位计数 1/1，页面建议关闭这个职位 |
| B7 | Marco 的入职材料逾期 | 能说出缺什么；记录"已完成"时会先问你确认，确认后显示绿色回执 |
| B8 | "I'm hiring a 16-year-old for weekends" | 提到未成年人的规定（州法规、工作时间、监护人签字等），并附官方来源 |
| B9 | Priya 辞职 | 给出离职步骤（通知期、最终工资期限等）；辞职确认信开头有 DRAFT；标记 left 前先问你确认 |
| B10 | Sam 的定期合同延长 3 个月 | **必须**说明定期合同的限制（包括续约在内总共不超过 2 年、最多续约 1 次，以及例外情况） |
| B11 | 员工一周没来上班 | 只给流程指导，并建议寻求专业意见 |

## C 右栏（10 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| C1 | 在 Hiring 里点任意"问 AI"的按钮 | 右边打开 400px 的右栏，**不跳转**页面；左侧导航收成图标 |
| C2 | 在同一个职位上再问一次 | 接着同一个对话 |
| C3 | 到 Staff 对另一个员工问一句 | 自动开新对话，顶部提示"New conversation…"，并有链接回到上一个对话 |
| C4 | AI 还在回答时，再在页面上点一个问 AI 的按钮 | 右栏里出现"Next"排队，当前回答结束后自动发出 |
| C5 | 在右栏里让 AI 改一条员工信息并确认 | 后面的 Staff 页面自动刷新 |
| C6 | Ctrl J | 打开 / 关闭右栏 |
| C7 | 把窗口拉到小于 1280 像素宽 | 右栏**浮在**页面上（有遮罩），导航不收起（这一步我没法验证） |
| C8 | 到 Conversations 页 | 不显示右栏；刚才的对话都在列表里 |

## D 账户菜单和 Settings（5 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| D1 | 点左下角你的名字 | 下拉菜单：Memory、Settings、Send feedback |
| D2 | 分别打开 Memory、Settings | 和以前的页面内容一样 |
| D3 | 在 Settings 里把工作区改到别的文件夹，再改回来 | 能切换；Sample data 标签跟着变 |

## E 语音 key（5 分钟，免费）

| # | 做什么 | 预期 |
|---|---|---|
| E1 | 没存 key 时，到 Conversations，鼠标悬停在麦克风上 | 麦克风是灰的；提示去 Settings 填 key，点提示能跳过去 |
| E2 | Settings › Voice 贴入错误的 key | 报错（OpenAI 不接受这个 key），**不保存** |
| E3 | 贴入正确的 key | 显示 `sk-…abcd`（最后 4 位）和检查时间；输入框里不再显示完整的 key |
| E4 | 关掉 app 再打开 | key 还在（只显示最后 4 位） |
| E5 | Remove key → 再存一次 | 删除后麦克风变灰；存回去后又可以用 |

## F 语音

**F-a 免费替身（项目里跑，不花钱）**：在项目目录运行 `npm run ui:fake`，打开它打印的链接。

| # | 做什么 | 预期 |
|---|---|---|
| Fa1 | Conversations › 麦克风 | 浏览器问麦克风权限（由你决定点允许）；出现语音条：listening |
| Fa2 | 随便说一句话，停一下 | 替身按顺序"听到"脚本里的请求（先是 "What do I need to do this week?"），聊天里显示成你说的话，AI 回答；语音条显示 working，然后 speaking（一个轻音） |
| Fa3 | 第二、第三句 | 第二句是 "Daniel Ortiz accepted…"：确认卡片出现在右边的 On screen 面板等你；替身下一句会说 "Yes, save it." 自动确认（详见 K 节） |
| Fa4 | 静音 / 取消静音，换麦克风（Settings） | 静音时替身听不到 |
| Fa5 | End | 显示 Voice ended 和时长；替身显示"demo voice, not billed"（真实语音显示估算费用） |
| Fa6 | 语音中切到别的页面，或在另一个标签页打开 | 别的标签页里不能开始其它操作（提示 Voice is on）；关掉开始语音的那个标签页，语音会停止 |

**F-b 真实语音（桌面程序，要花钱）**：在第 E 步存好 key 之后。

| # | 做什么 | 预期 |
|---|---|---|
| Fb1 | Conversations › 麦克风 | Windows 可能问麦克风权限；app 只申请麦克风这一项权限 |
| Fb2 | 问 "What do I need to do this week?" | 语音回答，同时聊天里有文字 |
| Fb3 | 它说话时打断它，问别的 | 马上停下来，回答新的问题（上次付费测试这一项失败过一次，要特别看） |
| Fb4 | "Hannah accepted the Team leader offer, she starts Monday" | 确认卡片出现在右边，语音会请你说 yes；说 "yes" 后 Staff 里有 Hannah，Team leader 显示已录用，右边出现两张卡片 |
| Fb5 | End | 显示计费秒数和大概费用；和 platform.openai.com 上的用量大致对得上 |

## G 反馈（5 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| G1 | 在一条回答下点 👍 | 显示 "Thanks: marked helpful." |
| G2 | 在另一条下点 👎，选两个原因，写一句话，Save feedback | 显示 "Thanks: noted what went wrong." |
| G3 | 名字 › Send feedback：写一句话，三项都勾上，保存 | 显示 Saved；Show in folder 打开 `C:\Users\<你>\MeritAI\Feedback\` |
| G4 | 用记事本打开那个 json | 有你写的话、2 条评分（包括问题和回答开头）、当前对话、版本号 0.2.2；**没有** key 或密码 |

## H 切换到自己的企业（5 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| H1 | 点顶部 **Sample data** › Switch to my own business | 进入空的工作区 `C:\Users\<你>\MeritAI`，日期变成今天，Sample data 标签消失 |
| H2 | Set up with the adviser，扮演 tester guide 里的 Dan Kowalski / Ridgeline Plumbing | 一步步问你企业信息；每次保存都先问你确认 |
| H3 | 看 Memory | 示例企业没有往你的 memory 里写东西 |

## J 对话和页面联动（今晚新做，15 分钟）

在示例企业里做。可以在 Conversations 页打字，也可以在别的页面打开右栏打字。

| # | 做什么 | 预期 |
|---|---|---|
| J1 | 在 Conversations 里说："Hannah accepted the Team leader offer, she starts Monday 5 October, full-time." | 只问**一次**确认，确认内容里有"Hired from: Team leader (Hannah Cole's application)"；回答下面出现"变更 / What changed"卡片：Hannah（入职前 N 件事，**Record paperwork**）和 Team leader（1 of 2 hired，进度条） |
| J2 | 看左侧导航 | Staff 和 Hiring 旁边有蓝点 |
| J3 | 点卡片上的 **Open in Staff** | 跳到 Staff，Hannah 那一行高亮并标着"New · MeritAI"；顶部有一条"MeritAI: Hannah Cole added · in “…”"，可以点 Back to the conversation；Staff 的蓝点消失 |
| J4 | 点 Hiring | Team leader 显示 1 of 2，Hannah 显示"Hired · in Staff"；顶部同样有一条变更说明 |
| J5 | 说 "Daniel Ortiz accepted too, same start date" | 卡片显示 2 of 2 hired，并出现 **Close the job**；AI 会问要不要关闭职位，不会自己关 |
| J6 | 在 Staff 页打开右栏，说 "I gave Marco his CEIS and TFN declaration today" | 确认后，右栏旁边的 Staff 表格马上刷新，Marco 那一行高亮 |
| J7 | 在 Conversations 里说 "Put Ruth on the shortlist for team leader, Kenji is a no" | Hiring 的排名里 Ruth 入围、Kenji 暂不考虑，两行都高亮 |
| J8 | 说 "We now need 4 weekend cleaners" / "Close the Office admin job" | 招聘人数、关闭状态都同步到 Hiring 页 |

## K 语音时屏幕跟着走（F-a 的免费替身就能看）

| # | 做什么 | 预期 |
|---|---|---|
| K1 | `npm run ui:fake` › Conversations › 麦克风；说一句话停一下，再说一句话停一下 | 替身先"听到"本周提醒，第二句是"Daniel Ortiz accepted the Team leader offer…" |
| K2 | 看右边 | Attention 面板变成 **On screen / 屏幕上**：添加 Daniel 的确认卡片在这里等你（聊天里也有），语音条显示"Waiting for your OK: …" |
| K3 | 再说一句话 | 替身这次说的是 "Yes, save it."，确认卡片自动变成已保存；右边出现 Daniel 和 Team leader 的卡片 |
| K4 | 真实语音（要花钱）时直接说 "yes" | 同上。删除类的改动必须点按钮，说 yes 无效 |
| K5 | `npm run ui:fake` › Hiring › 右上 Ask MeritAI 打开侧栏 › 侧栏输入框里的麦克风；说一句话停一下 | 页面不跳走，还在 Hiring；侧栏里蓝色语音条代替输入框，第一句是本周提醒 |
| K6 | 点右上按钮关掉侧栏 | 通话不断：按钮变成 "Voice on · 0:xx"，下面弹出一条说明（可以重新打开侧栏或结束语音） |
| K7 | 再说一句话 | 替身说 "Daniel Ortiz accepted…"：侧栏自己打开，确认卡片在最下面等你；左边 Team leader 标着 "Talking about" |
| K8 | 再说一句话（"Yes, save it."），然后在侧栏里点 End voice | 保存后 Daniel 在候选人表里显示已录用；结束后侧栏显示 Voice ended（替身不计费），顶栏按钮回到 Ask MeritAI |

## L 语音用量（Settings）

| # | 做什么 | 预期 |
|---|---|---|
| L1 | Settings › Voice › Usage | 今天 / 本月 / 累计的估算美元和分钟（ui:fake 下显示"演示引擎不计入"） |
| L2 | Monthly limit 填 1，Save limit | 显示"US$x of US$1.00 used this month"；达到上限后语音无法开始，通话中会自动停 |

## M 邮件草稿（MeritAI 不发邮件）

| # | 做什么 | 预期 |
|---|---|---|
| M1 | 说 "Email Priya the resignation acknowledgement, priya.nair@example.com" | 回答里有邮件卡片：收件人、主题、附件（那封确认信）、正文开头；**Open in email app**；旁边"Send from MeritAI · Coming soon"是灰的 |
| M2 | 点 Open in email app | Outlook（或默认邮件应用）打开一封**新邮件草稿**，收件人、主题、附件都在；你自己点发送（这一步我没法验证，因为会在你电脑上打开 Outlook） |
| M3 | Files › Outbox | 有一个 .eml 文件 |

## N 新建职位：模板

| # | 做什么 | 预期 |
|---|---|---|
| N1 | Hiring › New job | 默认"From a template"：行业按钮里你的行业排第一（示例企业是清洁），下面是职位卡片 |
| N2 | 搜 "chef"、"sparky" | 分别找到 Cook、Electrician |
| N3 | 选 Cleaner | 左边表单，右边职位描述随你的选择实时变化；上面有"Likely award: Cleaning Services Award [MA000022]"；方括号部分高亮，要你自己填 |
| N4 | 改名字、勾掉一条职责、Create job | 新职位出现，里面有"<名字> JD.docx"，下一步是 Draft the criteria；页面顶部有 **Add applications** |
| N5 | 另建一个，选 "Create and ask MeritAI to tailor it" | 右栏里 AI 用企业资料补全方括号部分，并在你确认后替换职位描述 |
| N6 | "My own job description" 和 "Write it with MeritAI" 两个标签 | 旧的上传表单、和 AI 一起写，都还在 |

## O 即将推出（Coming soon）

| # | 做什么 | 预期 |
|---|---|---|
| O1 | 左侧导航 **Connections**（标着 Soon） | 邮件和日历、招聘网站、发薪/任务/备份三组，每张卡片都是"Coming soon"；最下面是"套餐与更新" |
| O2 | 点几个 **I want this**，再 Send feedback | 反馈文件里有 `wantedConnections` |
| O3 | Hiring › 某职位 › **Advertise** | "Write the job ad"可用；Post to SEEK / LinkedIn Jobs / Indeed 是灰的"Coming soon" |
| O4 | Settings › About and updates | 最上面是版本和更新状态；"Plan"一行说明订阅制、在线备份等即将推出 |

## P 中文

| # | 做什么 | 预期 |
|---|---|---|
| P1 | Settings › Language · 语言 › 中文（简体） | 整个界面变中文（导航、按钮、表格标题、确认卡片、日期如"10月9日（周五）"）；员工姓名、职位名称、文件名保持英文 |
| P2 | 用中文问："Priya 辞职了，最后一天是 10 月 9 日，帮我起草确认信" | AI 用中文回答；保存的信是**英文**；Priya 标为离职 |
| P3 | 切回 English | 页面重新加载，恢复英文；AI 从下一条消息起用英文 |
| P4 | 语音用中文说话 | GPT-Live 本来就会跟着你说的语言回答（这一项没改过） |

## Q 反馈回收

| # | 做什么 | 预期 |
|---|---|---|
| Q1 | 你的名字（左下）› Send feedback | 多了可选的 "Your name"；说明是"保存成文件，再放进一封发给 MeritAI 团队的邮件" |
| Q2 | 填名字和一句话，Save the feedback file | 回执下面是 **Email it to the MeritAI team**、Show in folder、Done，并写明收件地址 ruihang2017@gmail.com |
| Q3 | 点 Email it to the MeritAI team | Outlook（或默认邮件程序）打开一封新邮件：收件人 ruihang2017@gmail.com，标题 "MeritAI feedback · 版本 · 日期"，附件是那个 json 文件。**不会自动发送**，你看一眼关掉即可 |
| Q4 | 再开一次 Send feedback | 名字已经记住 |
| Q5 | 把几个反馈文件放进一个文件夹，运行 `npx tsx scripts/feedback-report.ts <文件夹>` | 终端里一段摘要；文件夹里出现 "MeritAI feedback report <日期>.xlsx"：Overview、Not helpful、Notes、Errors 四张表 |

## R 自动更新（桌面版）

| # | 做什么 | 预期 |
|---|---|---|
| R1 | `npm run ui:fake -- --fake-update ready` | 顶栏出现绿色 **Update ready**；点开：版本、What's new、Restart to update / Later；点别处关闭 |
| R2 | 同上 › Settings › About and updates | 绿色一栏 "MeritAI 0.2.99 is ready" 和 Restart to update（演示里点了不会真的重启，终端打出一行 fake update） |
| R3 | `--fake-update downloading` | 顶栏 "Downloading update · 45%"，Settings 里是进度条 |
| R4 | 浏览器版（不加这个参数） | Settings 里写着"浏览器版从项目运行，更新只随桌面版提供" |
| R5 | 真正的更新：发 0.2.2 之后的下一版时 | 按 `docs/alpha/distribution.md` 先发草稿、本机试装，再正式发布；装着 0.2.2 的电脑几分钟内出现 Update ready |

## S 0.2.2 的新内容（9 月 29 日，15 分钟）

在示例企业里做（NSW，9 名员工，app 的"今天"是 2026-09-26）。每条都是新对话。

| # | 做什么 | 预期 |
|---|---|---|
| S1 | "We're hiring a full-time cleaner who starts on 5 October 2026. What do I need to do?" | 清单开头说明 5 October 2026 是星期一、是 NSW 的 **Labour Day** 公众假期；**不**叫你改日子；说明员工不上班的话，通常那天本来要上班的（casual 除外）要按正常工时付基本工资，细节打 Fair Work Infoline 13 13 94；带 Fair Work 链接 |
| S2 | "Our new cleaner will work from home in Melbourne. What's different for her?" | 按 VIC 的公众假期；长期服务假写"各州法律不同，问 NSW Industrial Relations 或 Workforce Inspectorate Victoria 适用哪个州"，**不**直接给天数；工伤保险提到 VIC |
| S3 | "Mia Rossi asked when she can become permanent." | 说明员工选择转正：满 12 个月（小企业）**并且**员工认为自己已不符合 casual 定义；不会自动转正；雇主要协商、21 天内书面答复、只能按法定理由拒绝；Mia 的最早日期已经到了（按 2025-06-19 入职算） |
| S4 | 同样问 Marco Silva | 最早日期是 **2027-09-06** |
| S5 | "Write a welcome email for Sam, who starts on Monday 13 October." | 2026 年 10 月 13 日是**星期二**：回答要么写对成 Tuesday，要么照抄了 Monday，这时回答下面出现黄色提醒 "This reply has a weekday that doesn't match its date…"（中文界面是"这条回复里的星期和日期对不上…"） |
| S6 | 名字 › Settings › About and updates | 版本 MeritAI 0.2.2 |

## I 清理

- Windows 设置 › 应用 › MeritAI › 卸载。
- 删掉 `%APPDATA%\MeritAI`、`C:\Users\<你>\MeritAI`、`C:\Users\<你>\MeritAI (sample)`。
- 语音 key 如果只是测试用的，到 platform.openai.com 把它作废。
