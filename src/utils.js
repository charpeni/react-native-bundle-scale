const chalk = require('chalk');
const execa = require('execa');
const ora = require('ora');
const { program } = require('commander');

/**
 * Computes the text to be displayed as the result of the action.
 *
 * @param {string | (() => string) | execa.ExecaReturnValue<string> | void} result - Result of the action.
 * @param {string} title - title used to describe the action.
 * @returns string | undefined - Returns the text to be displayed as the result of the action.
 */
function computeSucceedResult(result, title) {
  if (typeof result === 'string') {
    return `${title} ${chalk.green(result)}`;
  }

  if (typeof result === 'function') {
    return `${title} ${result()}`;
  }

  return undefined;
}

/**
 * Executes an async function using ora to display a spinner.
 *
 * @param {string} title - Title used to describe the action.
 * @param {() => Promise<string | void | execa.ExecaReturnValue<string>>} asyncFunction - Async function to be executed.
 */
async function action(title, asyncFunction) {
  const spinner = ora(title).start();

  try {
    const result = await asyncFunction();

    spinner.succeed(computeSucceedResult(result, title));
  } catch (error) {
    spinner.fail(
      program.opts().debug === true
        ? `${title}
${chalk.red(error)}`
        : undefined
    );
    process.exit(1);
  }
}

/**
 * Generates a source map explorer for the given bundle.
 *
 * @param {string} filename - Name of the bundle (excluding the extension)
 * @param {string} sourceDirectory - Directory where the bundle is located
 * @param {string} outputDirectory - Directory where the output will be generated
 * @returns string - Path to the generated source map
 */
async function generateSourceMapExplorer(
  filename,
  sourceDirectory,
  outputDirectory
) {
  const output = `${outputDirectory}/${filename}.html`;

  await execa(
    `npx source-map-explorer ${sourceDirectory}/${filename}.jsbundle --no-border-checks --html ${output}`,
    { shell: true }
  );

  return output;
}

/**
 * JSDoc types lack a non-null assertion.
 * https://github.com/Microsoft/TypeScript/issues/23405#issuecomment-873331031
 *
 * @template T
 * @param {T} value
 */
function notNull(value) {
  // Use `==` to check for both null and undefined
  if (value == null)
    throw new Error(`did not expect value to be null or undefined`);
  return value;
}

module.exports = {
  action,
  generateSourceMapExplorer,
  notNull,
};
