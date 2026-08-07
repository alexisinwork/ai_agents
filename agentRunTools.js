import { MODEL, MAX_STEPS, SYSTEM_PROMPT } from './config.js';
import { runnableTools } from './runnableTools.js';

/**
 * The same agent, handed to the SDK's automated function-call runner.
 *
 * `runTools` does what the loop in agent.js does by hand: sends the request,
 * sees `tool_calls`, finds the matching JS function, parses the arguments,
 * calls it, appends the result as a `tool` message, and goes round again until
 * the model replies without asking for a tool. agent.js exists to show that
 * machinery; this exists to show that you do not normally write it.
 *
 * `runFunctions` — the name that usually comes to mind — is the older sibling
 * of this method and is marked `@deprecated - use runTools instead` in the SDK.
 * It drives the legacy `functions` parameter, the one this project was
 * mistakenly passing its `tools` array to. Same idea, retired shape.
 *
 * Note this lives under `beta`. The runner helpers have been there since they
 * were introduced; the underlying Chat Completions endpoint is stable, but the
 * helper's API surface is not covered by the SDK's semver guarantees.
 *
 * Deliberately exposes the same signature and the same `onStep` events as
 * `runAgent`, so eval.js can run both through identical assertions.
 *
 * @param {import('openai').default} openai
 * @param {string} query
 * @param {{ onStep?: (event: object) => void }} [options]
 * @returns {Promise<string>} the model's final answer
 */
export async function runAgentWithRunner(openai, query, { onStep = () => {} } = {}) {
  const runner = openai.beta.chat.completions.runTools(
    {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      tools: runnableTools,
    },
    // The runner's own ceiling. Left at MAX_STEPS so the two implementations
    // are bounded the same way; its default is 10.
    { maxChatCompletions: MAX_STEPS },
  );

  // The runner emits a `message` for every message it appends, which is the
  // only place the trace is observable — the tool calls happen inside the
  // helper, so there is no point in the caller's code where they can be
  // intercepted. Reconstructing the events from the transcript is the cost of
  // not writing the loop.
  runner.on('message', (message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        onStep({ type: 'call', name: call.function.name, args: call.function.arguments });
      }
    } else if (message.role === 'tool') {
      onStep({ type: 'result', result: message.content });
    }
  });

  const answer = await runner.finalContent();

  // `finalContent()` reads the content off the last assistant message. If the
  // runner stopped because it hit `maxChatCompletions` mid-loop, that message
  // is a tool call, whose content is null — so exhaustion arrives as a quiet
  // null rather than an error. agent.js throws in the same situation. Turning
  // it back into a throw keeps the two interchangeable, and keeps a stuck agent
  // from being reported to the user as an empty answer.
  if (answer === null) {
    throw new Error(
      `Agent did not reach an answer within ${MAX_STEPS} model calls. It is probably looping on a failing tool.`,
    );
  }

  onStep({ type: 'answer', content: answer });
  return answer;
}
