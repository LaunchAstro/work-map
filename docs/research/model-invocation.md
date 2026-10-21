# Running one model read-only on the user's subscription

How release two's AI scoring runs one model through the user's own Claude Code or Codex sign-in, with tools off, on macOS, Windows and Linux, and never on an API key. Resolves #36.

Inputs: the maintainer's Q1 answer on the map issue (one model, the user's own subscription, no API spend, off by default, read-only with tools disabled, no OS sandbox), the child-process rules in `docs/spec/app-layout.md` (L21 to L23) and `docs/spec/release.md` (R6 to R8). Facts come from Anthropic's Claude Code docs, OpenAI's Codex docs and the Codex source, read on 21 October 2026, and from `--help` of Claude Code 2.1.306 and Codex CLI 0.162.1. No prompt was sent and no login was changed. Sources are at the end.

## The answer in short

- Settings hold one choice, `off`, `claude` or `codex`, and an optional model name. It starts at `off`. With no model named, the CLI uses its own default.
- The engine runs the CLI directly, no shell, in a fresh empty folder, prompt on stdin, JSON events on stdout, with every tool switch the CLI has turned off.
- Before any run it checks the sign-in with the CLI's own status command, run with the same environment as the scoring run. Anything but a subscription login stops scoring with a named line. The engine also strips API-key variables from the child's environment.
- Claude Code can truly turn every tool off, and each run proves it from the run's first event. Codex cannot. Its shell tool stays reachable, so Codex runs in its read-only sandbox, and any tool event kills the run and throws the answer away.
- One call at a time, at most 400 KB of prompt, 10 minutes per call. The answer must be one JSON value matching #38's schema. One retry on bad output, then the section keeps its last score.

## Facts

### Claude Code

- `claude -p` runs once and exits: 0 on success, non-zero on failure. A failure inside the run, such as missing authentication, is printed as the result on stdout. Piped stdin is capped at 10 MB. SIGTERM exits 143. ([headless](https://code.claude.com/docs/en/headless))
- `--tools ""` removes every built-in tool. It does not touch MCP tools, which need `--disallowedTools "mcp__*"` or no MCP servers. `--disallowedTools "*"` removes every tool. `EndConversation` survives a deny list only while another tool remains. ([CLI reference](https://code.claude.com/docs/en/cli-reference), [tools reference](https://code.claude.com/docs/en/tools-reference))
- `--strict-mcp-config` with no `--mcp-config` loads no MCP servers. `--safe-mode` skips CLAUDE.md, skills, plugins, hooks, MCP servers and custom agents, while "authentication, model selection, built-in tools, and permissions work normally". `--max-turns`, `--no-session-persistence` and `--permission-mode dontAsk` work in print mode. ([CLI reference](https://code.claude.com/docs/en/cli-reference))
- `--bare` is the documented choice for scripts, but it reads only `ANTHROPIC_API_KEY` or an `apiKeyHelper`, never the subscription login. The engine must never pass it. ([headless](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode))
- Credentials are chosen in this order: cloud provider variables, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic profiles, then the subscription login. "In non-interactive mode (`-p`), the key is always used when present." `CLAUDE_CODE_OAUTH_TOKEN` comes from `claude setup-token` and bills the subscription. ([authentication](https://code.claude.com/docs/en/authentication#authentication-precedence))
- `claude auth status` prints JSON and exits 0 when signed in, 1 when not. `authMethod` is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper` or `third_party`. ([CLI reference](https://code.claude.com/docs/en/cli-reference#cli-commands))
- With `--output-format stream-json --verbose`, the `system/init` event carries `tools`, `mcp_servers`, `model` and `apiKeySource`. `apiKeySource` is `none` for a claude.ai login and names the key otherwise. The last line is the `result` event with `subtype`, `is_error`, `result` and `permission_denials`. A `rate_limit_event` carries `allowed`, `allowed_warning` or `rejected`, and `credits_required` when the plan's included usage is spent. `total_cost_usd` is a local estimate, not a bill. ([TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript))
- `--json-schema` works by adding a `StructuredOutput` tool that the model calls. ([structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs#recognize-the-structuredoutput-tool-call))
- Install: native installer to `~/.local/bin/claude` on macOS and Linux and `%USERPROFILE%\.local\bin\claude.exe` on Windows, or Homebrew, WinGet, apt, dnf, apk and npm. Windows 10 1809 or later; Git for Windows is optional and only feeds the shell tools. ([setup](https://code.claude.com/docs/en/setup))

### Codex CLI

- `codex exec` runs once. With no prompt argument, or `-`, it reads the prompt from stdin. It runs in a read-only sandbox by default and needs `--skip-git-repo-check` outside a Git repository. `--json` turns stdout into JSONL events: `thread.started`, `turn.started`, `turn.completed` (with `usage`), `turn.failed`, `item.*` and `error`. Item types include agent messages, reasoning, command executions, file changes, MCP tool calls and web searches. `--output-schema <file>` asks for a final answer matching a JSON Schema. `--ephemeral` keeps no session files. Exit codes are not documented. ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode))
- `--ignore-user-config` skips `config.toml` while auth still uses `CODEX_HOME`. `--ignore-rules` skips execpolicy rules. `--disable <feature>` sets `features.<name>=false`. (`codex exec --help`)
- `features.shell_tool` turns command tools on or off. `features.unified_exec` is on everywhere and "user opt-outs are ignored". `web_search = "disabled"` removes the search tool. `tools.view_image` controls the image tool. `approval_policy = "never"` is the setting for non-interactive runs. ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference))
- Read-only sandbox: "the agent can inspect files, but it can't edit files or run commands without approval". macOS uses Seatbelt, Linux and WSL2 need `bubblewrap`, and native Windows has its own sandbox. ([sandboxing](https://learn.chatgpt.com/docs/sandboxing), [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox))
- ChatGPT sign-in uses the plan. An API key is billed "through your OpenAI Platform account at standard API rates". `CODEX_API_KEY` set for one `codex exec` run uses that key for that run. ([auth](https://learn.chatgpt.com/docs/auth), [environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables))
- `codex login status` writes one line to stderr and exits 0 when signed in: `Logged in using ChatGPT`, `API key configured - <masked key>`, `Logged in using access token`, `Logged in using personal access token`, two Amazon Bedrock lines, or `Logged in using workload identity`. Signed out, it prints `Not logged in` and exits 1. It ignores `CODEX_API_KEY` when it decides. ([login.rs](https://github.com/openai/codex/blob/main/codex-rs/cli/src/login.rs))
- `forced_login_method = "chatgpt"` exists, but on a mismatch Codex "logs the user out and exits". ([auth](https://learn.chatgpt.com/docs/auth))
- Install: standalone installer to `~/.local/bin/codex` (or `CODEX_INSTALL_DIR`) on macOS and Linux and `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` on Windows, or npm and Homebrew. ([Codex CLI](https://learn.chatgpt.com/docs/codex/cli), [install.sh](https://chatgpt.com/codex/install.sh), [install.ps1](https://chatgpt.com/codex/install.ps1))

## The rules

Every rule has a test. Unit tests use fake `claude` and `codex` programs that print scripted status lines and JSONL. The proof tests in M10 need a real subscription and run by hand before a release.

**M1. Off by default, one CLI.** `settings.json` gains `ai_scoring: { "cli": "off" | "claude" | "codex", "model": null }`, starting at `off`. The CLI is named by exactly the words `claude` or `codex`, because the #37 seat-cap guard matches them to Seat Gauge's seat rows. "One model" means the one CLI chosen here. With `model` null the engine passes no model flag, so Claude Code uses the user's own default and Codex its built-in default (its user config is skipped, M4). A named model goes to `--model` or `-m` unchanged. Turning scoring on shows the M3 check's outcome and one line: "Scoring sends each section's code to Anthropic (or OpenAI) under your plan's terms."
Test: a fresh settings file runs no model and never starts either CLI.

**M2. Finding the CLI without a shell.** Same order as L21 and R8. First `WORK_MAP_CLAUDE` or `WORK_MAP_CODEX`, then `PATH`, then the known folders. For `claude` these are `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` on macOS, `~/.local/bin`, `/usr/bin` and `/usr/local/bin` on Linux, and `%USERPROFILE%\.local\bin\claude.exe` on Windows. For `codex` they are `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`, and `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` on Windows. On Windows the engine runs only an `.exe`. It never runs an npm `.cmd` shim, because that needs `cmd.exe`. It then runs `--version` (15-second limit) and refuses anything below the version the M10 proof last passed on, recorded in the code.
Test: with `PATH` empty and a fake in a known folder the engine finds it; a lone `claude.cmd` on Windows gives `cli_missing` with the shim line; a version below the floor gives `cli_too_old`.

**M3. Subscription or nothing.** Before a batch of runs, and on Retry, the engine runs the status command with the M4 environment, no shell and a 30-second limit.
- Claude Code: `claude auth status --json`. Pass only when it exits 0 and `authMethod` is `claude.ai` or `oauth_token` (both bill the plan). `api_key`, `api_key_helper` and `third_party` are refused. So is a status that fails to parse or names an unknown method.
- Codex: `codex login status`. Pass only when it exits 0 and the first stderr line is exactly `Logged in using ChatGPT`. Every other line is refused, the access-token and Bedrock lines included. The engine never passes `forced_login_method`, because a mismatch signs the user out.

Test: each fake status (each `authMethod`, each Codex line, exit 1, garbage, timeout) gives the state in M9, and only the two Claude methods and the one Codex line reach `ready`.

**M4. The child's environment and folder.** The engine copies its own environment minus these variables. For Claude Code: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and `CLAUDE_CODE_USE_FOUNDRY`. For Codex: `CODEX_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CODEX_ACCESS_TOKEN`, `OPENAI_FEDERATION_RULE_ID` and `OPENAI_IDENTITY_TOKEN_FILE`. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` stay, so the user's own login is found. Stripping lets a user whose shell exports a key still score on the plan, and the M3 check catches keys set in the CLI's own settings. Each run gets a new empty temporary folder as its working folder, deleted afterwards, so no project's `.claude/`, `.mcp.json`, `AGENTS.md` or `.codex/` loads. The code reaches the model only as text on stdin.
Test: a fake CLI that dumps its environment and working folder shows none of the stripped names and an empty folder.

**M5. Claude Code invocation.** The same arguments on every OS:

```text
claude -p --safe-mode --tools "" --disallowedTools "*" --strict-mcp-config
  --permission-mode dontAsk --max-turns 1 --no-session-persistence
  --output-format stream-json --verbose
  --system-prompt "<scoring instructions from #38>" [--model <name>]
  "Score the code on stdin. Reply with the JSON object only."
```

The code text goes on stdin, which then closes. No `--bare` (it drops the subscription), no `--json-schema` (it adds a tool) and no `--max-budget-usd` (on a plan it would stop runs on an estimate).

**M6. Codex invocation.** The same arguments on every OS:

```text
codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules
  --sandbox read-only -c approval_policy="never" -c web_search="disabled"
  -c tools.view_image=false --disable shell_tool --disable multi_agent
  --disable apps --disable plugins --disable image_generation
  --disable browser_use --disable computer_use --color never
  --output-schema <temp>/schema.json [-m <name>] -
```

The scoring instructions and the code text go on stdin, which then closes. The schema file sits in the run's temporary folder. OpenAI's strict mode wants `additionalProperties: false` and every property required, so #38's schema must follow that. On Linux, Codex's sandbox needs `bubblewrap`; without it the sandbox fails closed, which is acceptable because no command should run anyway.

**M7. Running the child.** As L22: no shell, stdin piped, stdout and stderr captured, `CREATE_NO_WINDOW` on Windows. The child gets its own process group on macOS and Linux and a kill-on-close job object on Windows, so a timeout kills the whole tree. Limits: 400 KB of prompt text per call (about 100,000 tokens, far under Claude's 10 MB stdin cap and inside a 200,000-token window with room for the answer), 10 minutes per call, one call at a time across all projects. A section larger than 400 KB is trimmed by #38's rule and its score marked as a partial read.
Test: a fake that sleeps past the limit is killed with its child process, and the engine records `timeout`.

**M8. Guards during each run.** The engine reads stdout line by line.
- Claude Code: the `system/init` event must show `tools` empty, `mcp_servers` empty and `apiKeySource` equal to `none`. Otherwise the engine kills the run before the model answers. Any `tool_use` block, or any `permission_denials` in the result, discards the answer. A `rate_limit_event` with `allowed_warning` or `rejected`, or with `credits_required`, finishes the current call and pauses scoring until its `resetsAt`, so a plan with usage credits switched on is never pushed past its included usage.
- Codex: any `item.*` event of type command execution, file change, MCP tool call or web search kills the run and discards the answer. `turn.failed` or `error` ends the run as failed.

Test: scripted streams with a non-empty tool list, a key source, a tool call, a denial, a warning rate-limit event and a Codex command item each end in the right state, with no score written.

**M9. Strict JSON out.** The answer is the Claude result's `result` text, or the text of Codex's last agent message. The engine trims whitespace and removes one enclosing code fence if that is all there is. The rest must parse as exactly one JSON value and pass #38's schema in Rust, whatever the CLI already checked. On failure the engine retries once, with the same input plus "Your last reply was not valid JSON for the schema. Reply with the JSON object only." A second failure writes no score. The section keeps its last pinned score, and the card says "AI score failed" with the time. The engine never repairs output or guesses a number.
Test: fenced JSON passes, prose around JSON fails, a schema miss retries once, and two misses leave the old score in place.

| State | When | Line on screen |
| --- | --- | --- |
| `cli_missing` | not found, or only a `.cmd` shim | Claude Code (`claude`) is not installed. Install it from code.claude.com, sign in with your Claude plan, then press Retry. (Codex: install it from the Codex CLI page, run `codex login`, choose Sign in with ChatGPT.) |
| `cli_too_old` | below the proven version | This `claude` is older than AI scoring supports. Update it, then press Retry. |
| `signed_out` | status exit 1 | `claude` is not signed in. Run `claude` in a terminal, sign in with your Claude plan, then press Retry. |
| `api_key_only` | any refused method in M3 | `claude` is signed in with an API key or a cloud account, which bills per use. AI scoring runs only on a Claude plan. Sign in with your plan, then press Retry. |
| `tools_not_off` | an M8 tool guard fired | AI scoring stopped: `claude` offered the model a tool, so the answer was thrown away. Update it, or turn scoring off. |
| `paused_limit` | an M8 rate-limit event | AI scoring paused: your plan is near its limit. It starts again after the time shown. |
| `run_failed` | timeout, crash or two bad answers | AI score failed: the first stderr line, at most 200 characters. |

Scoring stops in every state but `ready` and `paused_limit`. Cards keep their last pinned scores with their dates.

**M10. Proof that tools are off.** A hand-run proof test per CLI and OS, on a real subscription, before each release and whenever the version floor moves. In a temporary folder it writes `canary.txt` holding a random string. It sends a prompt that asks the model to run `echo hi > made.txt`, read `canary.txt`, and search the web. It passes when the model answers in text only, `made.txt` does not exist, the canary string is not in the answer, and the M8 guards saw no tool. For Claude Code the init event's `tools` must also be empty. The floor in M2 is the newest version that passed. CI cannot run this proof because it has no subscription login, so CI runs the fake-CLI tests only.

## Risks and fallbacks

- **Codex keeps a shell.** `unified_exec` ignores opt-outs, so the model can still ask for a command. The read-only sandbox, `approval_policy = "never"`, the empty working folder and the M8 kill guard bound it. A read inside the sandbox can still reach the user's files before the guard reacts. Fallback, settled (Q12): Codex stays on offer and the enable screen recommends Claude Code; if the M10 proof ever shows a Codex command running, the next release drops Codex.
- **Status and run could disagree.** A key in a settings `env` block, or a new credential type, might pick a different credential at run time. M3 runs status with the same environment, and M8 checks Claude's `apiKeySource` on every run. Codex has no per-run auth signal in its events, so it rests on M3, M4 and `--ignore-user-config`.
- **Usage credits.** A Claude or ChatGPT plan with paid extra usage switched on can bill past its included usage. The M8 pause covers Claude Code. For Codex, the #37 seat-cap guard is the only brake. The enable screen says so.
- **Flags drift.** Both CLIs change every few days. An unknown `--disable` feature or a renamed flag fails the run, and `run_failed` shows it. The version floor and M10 catch it before release.
- **Prompt injection in the code.** With tools off, injected text can only bend the score. #38 should treat a score as advisory, with ticket counts carrying the bar between audits.

## Notes for other tickets

- #37 owns the seat-cap guard; M8's rate-limit pause sits beside it.
- #38 owns the scoring instructions, the JSON schema (strict-mode shaped, see M6) and the trimming rule for sections over 400 KB.
- #39 owns when runs happen; it should batch the M3 check once per batch, not per section.
- #40 carries M1 to M10 into build tickets. The two invocations, the guards and the fake-CLI tests are likely one ticket of about 400 lines.

## Sources

- Anthropic, Claude Code docs: [headless and print mode](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [authentication](https://code.claude.com/docs/en/authentication), [setup](https://code.claude.com/docs/en/setup), [tools reference](https://code.claude.com/docs/en/tools-reference), [structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs), [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).
- OpenAI, Codex docs: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [authentication](https://learn.chatgpt.com/docs/auth), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables), [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox), [Codex CLI](https://learn.chatgpt.com/docs/codex/cli).
- OpenAI, Codex source: [`codex-rs/cli/src/login.rs`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/login.rs) for the status lines; the [macOS and Linux](https://chatgpt.com/codex/install.sh) and [Windows](https://chatgpt.com/codex/install.ps1) installers for install folders.
- `claude --help` (2.1.306), `codex exec --help`, `codex login --help` and `codex features list` (0.162.1).
