# ai_agents

A tool-calling agent: ask it what to do this afternoon and it looks up where you
are, looks up the weather there, and answers from what it found.

Part of [ai_engineering](https://github.com/alexisinwork/ai_engineering).

## Getting started

```bash
npm install
cp .env.example .env   # add your OpenAI key
npm start
```

The location and weather APIs need no keys. The OpenAI key is inlined into the
browser bundle by Vite and readable by anyone who opens the page — local
practice only.

```bash
npm run eval           # smoke test, runs the agent in Node
```

## Two loops, same agent

The same agent is built twice. The radio buttons on the page switch between
them, and `npm run eval` runs both through identical assertions.

**`agent.js` — the loop written out.** Sends the conversation with the two tools
attached; if the reply contains `tool_calls`, it looks each name up in a
registry, parses the JSON arguments, calls the function, appends the result as a
`tool` message, and sends the whole array back. A reply with no tool calls is the
answer.

**`agentRunTools.js` — the same thing via `openai.beta.chat.completions.runTools()`.**
The SDK's automated function-call runner does all of the above internally. Tools
are passed with the implementation attached — the JS function sits inside
`function.function`, next to its schema — so there is no name-to-code lookup to
maintain, and no message bookkeeping.

`runFunctions` is the name that usually comes to mind here. It still exists, but
the SDK marks it `@deprecated - use runTools instead`: it drives the legacy
`functions` request parameter rather than `tools`. `runTools` is the current one.

| | `agent.js` | `runTools` |
| --- | --- | --- |
| Message history | yours to append | internal |
| Unknown tool name | you guard | handled, fed back to the model |
| Bad JSON arguments | you guard | `parse` throws, message fed back |
| A tool that *throws* | caught, fed back | **aborts the run** |
| Step ceiling | `MAX_STEPS`, throws | `maxChatCompletions`, default 10 |
| Hitting the ceiling | throws | `finalContent()` returns `null` |
| Observing tool calls | at the call site | `.on('message')` after the fact |

The last three rows are the ones to know. The runner reports exhaustion as a
quiet `null` rather than an error, so `agentRunTools.js` turns it back into a
throw — otherwise a stuck agent reaches the user as an empty answer. And the
runner does not wrap the tool call itself, which is why nothing in `tools.js`
throws.

## The tools

Deliberately coupled: `getCurrentWeather` takes a latitude and longitude, and
the only place to get those is `getLocation` — so the model has to chain them,
which is the part of function calling worth practising. A tool that took no
arguments would never exercise it.

| File | |
| --- | --- |
| `agent.js` | the hand-rolled loop — message history, dispatch, step limit |
| `agentRunTools.js` | the same agent via the SDK's `runTools` runner |
| `tools.js` | the two tools and the schemas the model is shown |
| `runnableTools.js` | those same tools reshaped for `runTools` |
| `config.js` | model, system prompt, step limit — shared by both |
| `eval.js` | Node smoke test — runs both, checks the tools were really called |
| `index.js` | browser wiring; renders the trace as it runs |

`runnableTools.js` maps over `tools.js` rather than restating the schemas. Two
copies drift, and once the tools differ the two loops are no longer comparable —
which is the only reason to keep both.

Nothing in `tools.js` throws. Failures come back as `{ error }` and go into the
transcript as normal tool results, because that is the only form the model can
react to — it can retry, or tell you what is missing. A thrown error just ends
the run.

## Notes

The page shows every tool call, not just the answer. That is the whole point:
an answer that was invented and an answer that was looked up read exactly the
same, and the trace is the only way to tell them apart.

This started as the hand-written ReAct loop in `ReAct.png` —
Thought/Action/PAUSE/Observation parsed back out of the reply with a regex.
Native function calling replaces it: the schema tells the model what exists, and
the arguments come back as JSON instead of prose.
