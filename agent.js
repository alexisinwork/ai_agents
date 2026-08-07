import { MODEL, MAX_STEPS, SYSTEM_PROMPT } from './config.js';
import { tools, availableFunctions } from './tools.js';

/**
 * The agent loop.
 *
 * The whole job is maintaining `messages`. The model has no memory between
 * requests, so everything it learned in step one has to be in the array sent in
 * step two — its own reply included. The version this replaces never pushed
 * anything, so all five iterations sent the identical two-message array and got
 * the identical answer back, five times, at full price.
 *
 * The client is a parameter rather than an import because the browser builds
 * it from `import.meta.env` and the Node smoke test from `process.env`. Passing
 * it in keeps this file runnable under both.
 *
 * @param {import('openai').default} openai
 * @param {string} query
 * @param {{ onStep?: (event: object) => void }} [options] - called as the loop
 *   runs, so a caller can show progress. The loop is otherwise silent.
 * @returns {Promise<string>} the model's final answer
 */
export async function runAgent(openai, query, { onStep = () => {} } = {}) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: query },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const message = response.choices[0].message;

    // Pushed before anything else, and pushed whole. The API rejects a `tool`
    // message whose `tool_call_id` does not match an assistant message already
    // in the array, so dropping this — or rebuilding it as
    // `{ role, content }` and losing `tool_calls` — breaks the next request.
    messages.push(message);

    const toolCalls = message.tool_calls ?? [];

    // No tool calls means the model is done deliberating and this is the answer.
    if (toolCalls.length === 0) {
      onStep({ type: 'answer', step, content: message.content });
      return message.content;
    }

    // One `tool` message per call, in the same order, or the API errors.
    for (const call of toolCalls) {
      const { name, arguments: rawArgs } = call.function;
      onStep({ type: 'call', step, name, args: rawArgs });

      const result = await callTool(name, rawArgs);

      onStep({ type: 'result', step, name, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  throw new Error(
    `Agent did not reach an answer within ${MAX_STEPS} steps. It is probably looping on a failing tool.`,
  );
}

/**
 * Runs one tool call and returns its result as a string.
 *
 * Nothing in here throws. An unknown tool name, unparseable arguments and a
 * dead network all come back as `{ error }` and go into the transcript as a
 * normal tool result, because that is the only form the model can react to —
 * it can retry with different arguments, or tell the user what is missing. A
 * thrown error just ends the run with a stack trace the user cannot act on.
 *
 * The model does invent tool names and does emit malformed JSON, rarely. Both
 * are handled here rather than trusted.
 */
async function callTool(name, rawArgs) {
  const fn = availableFunctions[name];
  if (!fn) {
    return JSON.stringify({
      error: `No tool named "${name}". Available tools: ${Object.keys(availableFunctions).join(', ')}.`,
    });
  }

  let args;
  try {
    // Absent arguments arrive as "" or undefined for a no-parameter tool.
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: `Arguments for "${name}" were not valid JSON: ${rawArgs}` });
  }

  try {
    return await fn(args);
  } catch (err) {
    return JSON.stringify({ error: `"${name}" threw: ${err.message}` });
  }
}
