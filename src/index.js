#!/usr/bin/env node
const chalk = require('chalk');
const execa = require('execa');
const { filesize } = require('filesize');
const fs = require('node:fs/promises');
const path = require('node:path');
const prependFile = require('prepend-file');
const { program } = require('commander');
const tmp = require('tmp');

const { action, generateSourceMapExplorer, notNull } = require('./utils');

const { version } = require('../package.json');

tmp.setGracefulCleanup();

const PROJECT_NAME = 'BundleSize';
const ORIGINAL_BUNDLE_NAME = 'original';
const WITH_PACKAGES_BUNDLE_NAME = 'withPackages';

/** @type {Array<string>} */
let packagesToAdd = [];
/** @type {Record<string, string>} */
let dependencies = {};

program
  .description(
    'A command-line interface to see how adding packages affects your React Native JavaScript bundle.'
  )
  .version(version, '-v, --version', 'Show version number')
  .option('-d, --debug')
  .option('-rnv, --react-native-version [version]', 'React Native version')
  .option(
    '-p, --package-json [package.json]',
    'Use the package.json from the current working directory (or provided path) as default dependencies for the sample app',
    false
  )
  .arguments('[packages...]')
  .action((/** @type {Array<string>} */ packages) => {
    if (packages) {
      packagesToAdd = packages;
    }
  });

program.parse(process.argv);

const options = program.opts();

if (packagesToAdd && packagesToAdd.length === 0) {
  console.error('You must provide at least one package to add.');
  process.exit(1);
}

(async () => {
  let reactNativeVersion = options.reactNativeVersion || 'latest';
  /** @type {Array<[string, string]>} */
  let dependenciesWithoutReact = [];
  /** @type {Array<string>} */
  let existingDependenciesNames = [];
  /** @type {string | undefined} */
  let tempDirectory;

  if (options.packageJson !== false) {
    const pathToPackageJson =
      options.packageJson === true
        ? path.resolve(process.cwd(), 'package.json')
        : options.packageJson;

    await action(
      `Reading package.json ${
        options.debug ? chalk.blue(pathToPackageJson) : ''
      }`,
      async () => {
        const contents = await fs.readFile(pathToPackageJson, {
          encoding: 'utf8',
        });

        dependencies = JSON.parse(contents).dependencies;
        dependenciesWithoutReact = Object.entries(dependencies).filter(
          ([key]) => key !== 'react-native' && key !== 'react'
        );
        existingDependenciesNames = Object.values(dependenciesWithoutReact).map(
          ([packageName]) => packageName
        );

        reactNativeVersion = dependencies['react-native'];

        if (reactNativeVersion == null) {
          throw new Error('This is not a React Native project.');
        }

        return `Found react-native@${reactNativeVersion}`;
      }
    );
  }

  await action('Creating a temporary directory', async () => {
    return new Promise((resolve, reject) => {
      tmp.dir((error, directoryPath) => {
        if (error) {
          reject(error);
        }

        tempDirectory = `${directoryPath}/${PROJECT_NAME}`;

        resolve(options.debug === true ? chalk.blue(tempDirectory) : undefined);
      });
    });
  });

  await action(
    `Creating a sample app with react-native@${reactNativeVersion}`,
    () => {
      return execa(
        `npx --yes react-native@${reactNativeVersion} init ${PROJECT_NAME} --directory ${tempDirectory} ${
          reactNativeVersion !== 'latest'
            ? `--version ${reactNativeVersion}`
            : ''
        }`,
        {
          shell: true,
        }
      );
    }
  );

  if (options.packageJson !== false) {
    await action(
      `Adding ${dependenciesWithoutReact.length} dependencies from your package.json to the sample app`,
      () => {
        return execa(
          `yarn add ${dependenciesWithoutReact
            .map(([key, value]) => `${key}@"${value}"`)
            .join(' ')}`,
          {
            cwd: tempDirectory,
            shell: true,
          }
        );
      }
    );

    await action(
      `Importing ${dependenciesWithoutReact.length} dependencies from your packages.json to the sample app`,
      () => {
        return prependFile(
          `${tempDirectory}/index.js`,
          `${dependenciesWithoutReact.map(
            ([packageName], index) =>
              `import * as OriginalPackage${index} from '${packageName}';`
          ).join(`
`)}
`
        );
      }
    );
  }

  await action('Bundling sample app', async () => {
    return execa(
      'npx',
      [
        'react-native',
        'bundle',
        '--entry-file',
        'index.js',
        '--platform',
        'ios',
        '--dev',
        'false',
        '--bundle-output',
        `${ORIGINAL_BUNDLE_NAME}.jsbundle`,
        '--sourcemap-output',
        `${ORIGINAL_BUNDLE_NAME}.map`,
      ],
      { cwd: tempDirectory }
    );
  });

  await action(`Adding ${packagesToAdd.join(' ')}`, () => {
    return execa(`yarn add ${packagesToAdd.join(' ')}`, {
      cwd: tempDirectory,
      shell: true,
    });
  });

  await action(`Importing ${packagesToAdd.join(' ')}`, () => {
    return prependFile(
      `${tempDirectory}/index.js`,
      `${packagesToAdd
        .filter(
          (packageName) => !existingDependenciesNames.includes(packageName)
        )
        .map(
          (packageName, index) =>
            `import * as Package${index} from '${packageName}';`
        ).join(`
    `)}
    `
    );
  });

  await action('Bundling sample app again', () => {
    return execa(
      'npx',
      [
        'react-native',
        'bundle',
        '--entry-file',
        'index.js',
        '--platform',
        'ios',
        '--dev',
        'false',
        '--bundle-output',
        `${WITH_PACKAGES_BUNDLE_NAME}.jsbundle`,
        '--sourcemap-output',
        `${WITH_PACKAGES_BUNDLE_NAME}.map`,
      ],
      { cwd: tempDirectory }
    );
  });

  await action('Comparing size of bundles', async () => {
    const [{ size: originalSize }, { size: polyfillSize }] = await Promise.all([
      fs.stat(`${tempDirectory}/${ORIGINAL_BUNDLE_NAME}.jsbundle`),
      fs.stat(`${tempDirectory}/${WITH_PACKAGES_BUNDLE_NAME}.jsbundle`),
    ]);

    return chalk.white(`
📦 The original bundle is: ${chalk.bold(filesize(originalSize))}
📦 The bundle with ${packagesToAdd.join(' ')} is: ${chalk.bold(
      filesize(polyfillSize)
    )}
⚖️  Therefore, ${packagesToAdd.join(' ')} adds ${chalk.bold.red(
      `${filesize(polyfillSize - originalSize)} (+${Math.round(
        (polyfillSize * 100) / originalSize - 100
      )}%)`
    )} to the JavaScript bundle`);
  });

  await action('Generating sources map explorer', async () => {
    const { name: sourceMapOutputDirectory } = tmp.dirSync({ keep: true });

    const [originalOutput, withPackagesOutput] = await Promise.all([
      generateSourceMapExplorer(
        ORIGINAL_BUNDLE_NAME,
        notNull(tempDirectory),
        sourceMapOutputDirectory
      ),
      generateSourceMapExplorer(
        WITH_PACKAGES_BUNDLE_NAME,
        notNull(tempDirectory),
        sourceMapOutputDirectory
      ),
    ]);

    return chalk.white(`
Original source map explorer: ${chalk.underline(originalOutput)}
With ${packagesToAdd.join(' ')}: ${chalk.underline(withPackagesOutput)} 
`);
  });
})();
