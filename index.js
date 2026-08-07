import openai from './openaiClient.js';
import { runAgent } from './agent.js';
import { runAgentWithRunner } from './agentRunTools.js';

/**
 * Browser wiring.
 *
 * The page shows the tool calls as they happen, not just the final answer.
 * That is the only reason this project is interesting: the answer alone looks
 * like any other chat reply, and gives you no way to tell whether the model
 * looked anything up or made it up. The trace does.
 *
 * The radio buttons pick which loop runs. Both take the same arguments and emit
 * the same events, so the switch is a one-line lookup — and the traces should
 * be indistinguishable, which is the thing worth seeing.
 */

const IMPLEMENTATIONS = {
  manual: runAgent,
  runner: runAgentWithRunner,
};

const form = document.querySelector('#ask-form');
const input = document.querySelector('#query');
const button = form.querySelector('button');
const output = document.querySelector('#output');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const query = input.value.trim();
  if (!query) return;

  const choice = form.ownerDocument.querySelector('input[name="impl"]:checked').value;
  const runImplementation = IMPLEMENTATIONS[choice];

  button.disabled = true;
  output.replaceChildren();
  addLine('question', query);
  addLine('trace', choice === 'runner' ? 'via openai.beta.chat.completions.runTools' : 'via agent.js');
  const thinking = addLine('pending', 'Thinking…');

  try {
    const answer = await runImplementation(openai, query, { onStep: renderStep });
    thinking.remove();
    addLine('answer', answer);
  } catch (err) {
    thinking.remove();
    addLine('error', err.message);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

function renderStep(event) {
  if (event.type === 'call') {
    addLine('trace', `→ ${event.name}(${formatArgs(event.args)})`);
  } else if (event.type === 'result') {
    addLine('trace', `← ${truncate(event.result, 160)}`);
  }
}

/** Re-serialised so the trace reads as one line whatever the model emitted. */
function formatArgs(rawArgs) {
  if (!rawArgs) return '';
  try {
    const args = JSON.parse(rawArgs);
    return Object.entries(args)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  } catch {
    return rawArgs;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function addLine(kind, text) {
  const line = document.createElement('li');
  line.className = kind;
  line.textContent = text;
  output.append(line);
  return line;
}
