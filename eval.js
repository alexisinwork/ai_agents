import OpenAI from 'openai';
import { runAgent } from './agent.js';
import { runAgentWithRunner } from './agentRunTools.js';
import { getLocation, getCurrentWeather } from './tools.js';

/**
 * A smoke test for both loops. `npm run eval`.
 *
 * Builds its own client from `process.env` rather than importing
 * openaiClient.js, which reads `import.meta.env` and only exists under Vite.
 *
 * What it checks is the part that used to be broken and looked fine: that the
 * model actually calls the tools, that it carries `getLocation`'s coordinates
 * into `getCurrentWeather` instead of inventing its own, and that the numbers
 * in the answer are the numbers the API returned. A run that answers fluently
 * without calling anything is the exact failure this project had, and it is
 * invisible if you only read the reply.
 *
 * Both implementations run through the identical assertions below. That is the
 * point of giving them the same signature: if the hand-rolled loop and the SDK
 * runner are really equivalent, one set of checks should hold for both, and any
 * place it does not is a real difference worth knowing about.
 */

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  console.error('OPENAI_API_KEY (or VITE_OPENAI_API_KEY) is missing from .env.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });

const QUERY =
  'What are some activity ideas I could do this afternoon, based on my location and the weather?';

let failures = 0;

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures++;
}

// --- The tools on their own -------------------------------------------------
// Run first, so that a dead API is distinguishable from a model that chose not
// to call it.

console.log('\nTools\n-----');

const location = JSON.parse(await getLocation());
check('getLocation returns a city', Boolean(location.city), location.city ?? location.error);
check(
  'getLocation returns usable coordinates',
  Number.isFinite(location.latitude) && Number.isFinite(location.longitude),
  `${location.latitude}, ${location.longitude}`,
);

const weather = JSON.parse(
  await getCurrentWeather({ latitude: location.latitude, longitude: location.longitude }),
);
check(
  'getCurrentWeather returns a temperature',
  Number.isFinite(weather.temperature),
  `${weather.temperature}°${weather.unit}, ${weather.forecast}`,
);

// Bad input has to come back as data, not an exception. agent.js feeds it to
// the model to recover from; runTools does not wrap the call at all, so a throw
// here would abort the runner outright.
const rejected = JSON.parse(await getCurrentWeather({ latitude: undefined, longitude: undefined }));
check('getCurrentWeather reports missing coordinates as an error', Boolean(rejected.error));

// --- Both loops -------------------------------------------------------------

/**
 * The assertions that should hold whichever loop produced the answer.
 */
async function exercise(label, implementation) {
  console.log(`\n${label}\n${'-'.repeat(label.length)}`);

  const called = [];
  let answer;

  try {
    answer = await implementation(openai, QUERY, {
      onStep: (event) => {
        if (event.type === 'call') {
          called.push({ name: event.name, args: event.args });
          console.log(`  → ${event.name}(${event.args || ''})`);
        }
        if (event.type === 'result') {
          console.log(`  ← ${event.result.slice(0, 110)}`);
        }
      },
    });
  } catch (err) {
    check(`${label} completed`, false, err.message);
    return;
  }

  const names = called.map((call) => call.name);
  check('called getLocation', names.includes('getLocation'));
  check('called getCurrentWeather', names.includes('getCurrentWeather'));

  const weatherCall = called.find((call) => call.name === 'getCurrentWeather');
  const passedCoords = weatherCall ? JSON.parse(weatherCall.args || '{}') : {};
  check(
    'passed getLocation coordinates into getCurrentWeather',
    Math.abs(Number(passedCoords.latitude) - location.latitude) < 0.5 &&
      Math.abs(Number(passedCoords.longitude) - location.longitude) < 0.5,
    `sent ${passedCoords.latitude}, ${passedCoords.longitude}`,
  );

  check('produced an answer', typeof answer === 'string' && answer.length > 0);
  check(
    'answer names the city the tool returned',
    typeof answer === 'string' && answer.toLowerCase().includes(String(location.city).toLowerCase()),
    location.city,
  );
  check(
    'answer uses the temperature the tool returned',
    typeof answer === 'string' && answer.includes(String(Math.round(weather.temperature))),
    `${Math.round(weather.temperature)}°`,
  );

  console.log(`\n${answer}\n`);
}

await exercise('Hand-rolled loop (agent.js)', runAgent);
await exercise('SDK runner (agentRunTools.js)', runAgentWithRunner);

console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
