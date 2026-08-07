/**
 * Constants shared by the browser entry point and the Node smoke test.
 *
 * Deliberately holds no client and reads no environment: `import.meta.env`
 * exists only under Vite and `process.env` only under Node, so anything that
 * touches either can be imported from one side but not the other. Keeping this
 * file inert is what lets both sides share the same prompt and model.
 */

/**
 * gpt-4o-mini is the cheapest model that is reliably good at multi-step tool
 * calling — it will chain getLocation into getCurrentWeather without being
 * told to. gpt-3.5-turbo, which this used before, frequently answered from
 * memory instead of calling anything.
 */
export const MODEL = 'gpt-4o-mini';

/**
 * A ceiling on round trips, not on tool calls: the model can request several
 * tools in one turn. Two steps is the expected path here (locate, then fetch
 * weather, then answer on the third), so five leaves room for a retry after a
 * failed lookup without letting a confused model bill indefinitely.
 */
export const MAX_STEPS = 5;

/**
 * The prompt says nothing about *how* to call tools, and that is the point of
 * function calling: the schema in tools.js already tells the model what exists
 * and what each argument means. The hand-written ReAct
 * Thought/Action/PAUSE/Observation script this project started with was doing
 * that job in prose, and had to be parsed back out of the reply with a regex.
 *
 * What is left is the part the schema cannot express — that guessing is worse
 * than looking things up, and that a vague answer is a failure even when it
 * reads well.
 */
export const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about the user's location and the weather there.

- Never guess the user's location or the weather. Call the tools instead, even if you think you know the answer.
- getCurrentWeather needs coordinates: call getLocation first to get them.
- Answer using the values the tools returned. Name the actual city, the actual temperature and the actual conditions.
- If a tool returns an error, say what failed and answer with what you do have. Do not invent the missing part.
- Be specific and concise. No markdown headings, no bullet lists unless you are listing suggestions.`;
