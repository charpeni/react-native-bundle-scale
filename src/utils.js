const chalk = require('chalk');
const execa = require('execa');
const ora = require('ora');
const program = require('commander');

function computeSucceedResult(result, text) {
  if (typeof result === 'string') {
    return `${text} ${chalk.green(result)}`;
  }

  if (typeof result === 'function') {
    return `${text} ${result()}`;
  }

  return undefined;
}

async function action(text, promise) {
  const spinner = ora(text).start();

  try {
    const result = await promise;

    spinner.succeed(computeSucceedResult(result, text));
  } catch (error) {
    spinner.fail(
      program.debug === true
        ? `${text}
${chalk.red(error)}`
        : undefined
    );
    process.exit(1);
  }
}

async function generateSourceMapExplorer(
  filename,
  sourceDirectory,
  outputDirectory
) {
  const output = `${outputDirectory}/${filename}.html`;

  await execa(
    `npx source-map-explorer ${sourceDirectory}/${filename}.jsbundle --html ${output}`,
    { shell: true }
  );

  return output;
}

module.exports = {
  action,
  generateSourceMapExplorer,
};
