# AGENTS.md

A tool-calling agent: asked what to do this afternoon, it looks up location,
then weather there, then answers from what it found. The same agent is built
twice so the two loops can be compared.

Part of [ai_engineering](https://github.com/alexisinwork/ai_engineering).

## Setup

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY
npm start              # localhost:5173
```

## Commands

| | |
| --- | --- |
| `npm start` | Vite dev server; radio buttons switch between the two loops |
| `npm run eval` | Node smoke test -- runs both through identical assertions |

## Layout

| File | |
| --- | --- |
| `agent.js` | the hand-rolled loop -- message history, dispatch, step limit |
| `agentRunTools.js` | the same agent via the SDK's `runTools` runner |
| `tools.js` | the two tools and the schemas the model is shown |
| `runnableTools.js` | those tools reshaped for `runTools`, mapped from `tools.js` |
| `config.js` | model, system prompt, step limit -- shared by both |
| `eval.js` | asserts the tools were really called, for both loops |

## Conventions

- **Both loops must stay comparable.** `runnableTools.js` maps over `tools.js`
  rather than restating schemas -- two copies drift, and once the tools differ
  there is no reason to keep both.
- **Nothing in `tools.js` throws.** Failures return `{ error }` and enter the
  transcript as normal tool results, which is the only form the model can react
  to. `runTools` aborts the whole run on a thrown tool error.
- **`runTools` reports exhaustion as `null`, not an error.** `agentRunTools.js`
  turns that back into a throw; without it a stuck agent reaches the user as an
  empty answer.
- **The tools are deliberately coupled** -- `getCurrentWeather` needs
  coordinates only `getLocation` provides -- so the model must chain them. A
  tool taking no arguments would not exercise function calling.
- **The page renders every tool call, not just the answer.** The trace is the
  only way to tell a looked-up answer from an invented one. Keep it.
- Use `runTools`, not the deprecated `runFunctions`.

## Non-negotiables

- **Complexity and development time are not factors.** Never scope work down,
  pick a simpler approach, or skip a step because it is hard or would take
  longer. When there is a right way and a quick way, take the right way. Do not
  offer the quick way as an alternative, and do not cite effort, complexity or
  time as a reason for any decision.
- **Measure, do not guess.** Thresholds, chunk sizes, limits and model choices
  are derived from the data and the number is recorded. A guessed value that
  appears to work is the specific failure this codebase is built to prevent.
- **Evals call the real function.** Never test a copy of a code path. If a stage
  cannot be reached from Node because it reads `import.meta.env`, restructure it
  -- pass the client in as an argument -- rather than writing a second copy.
- **A prompt rule is a tendency; code is a guarantee.** Anything that must hold
  goes in code. Keep the prompt rule as well where it also shapes what the model
  *adds*, which code cannot do.
- **Failures must be visible.** Prefer a loud failure to a plausible one. An
  invented answer and a real one read identically, so silence is the dangerous
  outcome, not an error.
- **Document the failure, not just the fix.** READMEs and `THEORY.md` record
  what was tried, what it cost, and why it did not work. Do not delete that
  history when editing.

## Keys

`.env` is gitignored. The OpenAI key is inlined into the browser bundle by Vite
and readable by anyone who opens the page -- local practice only. Do not deploy
this as-is.

## Documentation

This is the one project in
[ai_engineering](https://github.com/alexisinwork/ai_engineering) with **no**
`THEORY.md` -- the README carries the concepts instead, including the table
comparing the two loops. Adding one is outstanding work; until then, keep the
README doing that job and update it in the same commit as the code. It is
written to be read -- prose and tables, not bullet dumps.
