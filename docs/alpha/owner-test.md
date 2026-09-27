# Alpha 发出前的整体测试（给项目负责人）

从上到下做一遍，每步对照"预期"。有问题记下步骤号和截图；也可以在 app 里用 Send feedback 存一个文件发给开发。

全部用示例企业或虚构数据。A–G 大约 60 分钟；语音（第 F 步）另算，真实语音约 US$0.05/分钟。

## 0 准备

- 先停掉旧的 `npm run ui:demo` / `ui:fake` 窗口（它们用的是旧代码）。
- 桌面程序的登录、memory 和语音 key 都在 `%APPDATA%\MeritAI`，和项目里的是分开的，所以要**重新登录一次**。
- 准备一个 OpenAI API key（第 E、F 步用，**不要**用 `OPENAI_API_KEY` 那个），再准备一个故意写错的 key，比如 `sk-test123456789012345`。
- 屏幕宽度大于 1280 像素（第 C 步要把窗口拉宽再拉窄）。

## A 安装和第一次启动（10 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| A1 | 运行 `release\MeritAI Setup 0.1.0.exe` | 可能弹出 SmartScreen 警告（没有签名），点 More info › Run anyway；装到当前用户下，开始菜单出现 MeritAI |
| A2 | 从开始菜单打开 MeritAI | 一个窗口，标题 MeritAI；出现首次运行的登录页 |
| A3 | Sign in with ChatGPT → 在浏览器里登录并输入代码 | 回到 app 后自动进入下一步，**不用**手动刷新 |
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
| Fa3 | 第二、第三句 | "Priya is resigning…"：这类要确认的改动在语音中**不保存**，结束后出现 Review and save |
| Fa4 | 静音 / 取消静音，换麦克风（Settings） | 静音时替身听不到 |
| Fa5 | End | 显示 Voice ended、时长和估算的费用（替身不会真的扣费） |
| Fa6 | 语音中切到别的页面，或在另一个标签页打开 | 别的标签页里不能开始其它操作（提示 Voice is on）；关掉开始语音的那个标签页，语音会停止 |

**F-b 真实语音（桌面程序，要花钱）**：在第 E 步存好 key 之后。

| # | 做什么 | 预期 |
|---|---|---|
| Fb1 | Conversations › 麦克风 | Windows 可能问麦克风权限；app 只申请麦克风这一项权限 |
| Fb2 | 问 "What do I need to do this week?" | 语音回答，同时聊天里有文字 |
| Fb3 | 它说话时打断它，问别的 | 马上停下来，回答新的问题（上次付费测试这一项失败过一次，要特别看） |
| Fb4 | "Just hired Hannah, she accepted the offer, starting Monday as a cleaner" | 语音中不保存；结束后出现 Review and save，确认后 Staff 里有 Hannah（Hiring 那边**不会**跟着变，见下一轮的讨论） |
| Fb5 | End | 显示计费秒数和大概费用；和 platform.openai.com 上的用量大致对得上 |

## G 反馈（5 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| G1 | 在一条回答下点 👍 | 显示 "Thanks: marked helpful." |
| G2 | 在另一条下点 👎，选两个原因，写一句话，Save feedback | 显示 "Thanks: noted what went wrong." |
| G3 | 名字 › Send feedback：写一句话，三项都勾上，保存 | 显示 Saved；Show in folder 打开 `C:\Users\<你>\MeritAI\Feedback\` |
| G4 | 用记事本打开那个 json | 有你写的话、2 条评分（包括问题和回答开头）、当前对话、版本号 0.1.0；**没有** key 或密码 |

## H 切换到自己的企业（5 分钟）

| # | 做什么 | 预期 |
|---|---|---|
| H1 | 点顶部 **Sample data** › Switch to my own business | 进入空的工作区 `C:\Users\<你>\MeritAI`，日期变成今天，Sample data 标签消失 |
| H2 | Set up with the adviser，扮演 tester guide 里的 Dan Kowalski / Ridgeline Plumbing | 一步步问你企业信息；每次保存都先问你确认 |
| H3 | 看 Memory | 示例企业没有往你的 memory 里写东西 |

## I 清理

- Windows 设置 › 应用 › MeritAI › 卸载。
- 删掉 `%APPDATA%\MeritAI`、`C:\Users\<你>\MeritAI`、`C:\Users\<你>\MeritAI (sample)`。
- 语音 key 如果只是测试用的，到 platform.openai.com 把它作废。
