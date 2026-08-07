import { tools, availableFunctions } from './tools.js';

/**
 * The same two tools, in the shape `runTools` wants.
 *
 * The runner takes schema and implementation together — the JS function goes
 * inside `function.function`, next to the JSON Schema describing it. The plain
 * Chat Completions API keeps them apart, which is why agent.js needs the
 * `availableFunctions` lookup to get from a returned tool name back to code.
 * Here that lookup *is* the tool definition.
 *
 * Built by mapping over the existing `tools` array rather than by writing the
 * schemas out again. Two copies of the same schema drift, and then the two
 * implementations are no longer comparable — the interesting difference between
 * them is the loop, and it stops being visible the moment the tools differ.
 */
export const runnableTools = tools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    function: availableFunctions[tool.function.name],
    parse: parseArguments,
  },
}));

/**
 * `parse` runs on the raw argument string before the function is called.
 *
 * Supplying it is what makes the runner hand the tool a parsed object instead
 * of a string, and it is also the runner's error hook: a throw in here is
 * caught, and the message is fed back to the model as the tool result so it can
 * retry. That is the same recovery agent.js has to arrange by hand.
 *
 * Lenient about emptiness because `getLocation` takes no arguments, and a model
 * calling it sometimes sends `""` rather than `"{}"`. Bare `JSON.parse` would
 * throw on that and burn a round trip re-asking for arguments that do not
 * exist.
 */
function parseArguments(input) {
  if (!input || !input.trim()) return {};
  return JSON.parse(input);
}
