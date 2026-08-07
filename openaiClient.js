import OpenAI from 'openai';

/**
 * The browser's OpenAI client.
 *
 * Vite does not shim `process` in the browser, so `process.env.AI_KEY` — what
 * this project used before — was a ReferenceError on the first line, and the
 * page never ran at all. It has to be `import.meta.env`, and the variable has
 * to carry the `VITE_` prefix or Vite will not expose it.
 *
 * That prefix is also the warning: the key is inlined into the bundle in plain
 * text and readable by anyone who opens the page. `dangerouslyAllowBrowser` is
 * the SDK saying the same thing. Fine for a local exercise, never for anything
 * deployed — that needs a server holding the key.
 */
const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  throw new Error('VITE_OPENAI_API_KEY is missing. Copy .env.example to .env and fill it in.');
}

export default new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
