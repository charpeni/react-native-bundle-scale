const chalk = require('chalk');
const execa = require('execa');
const filesize = require('filesize');
const fs = require('fs');
const path = require('path');
const prependFile = require('prepend-file');
const program = require('commander');
const tmp = require('tmp');

const { action, generateSourceMapExplorer } = require('./utils');

const { version } = require('../package.json');

let packagesToAdd = [];
let dependencies = {};

program
  .version(version, '-v, --version', 'output the version number')
  .option('-d, --debug')
  .option(
    '-p, --package-json [package.json]',
    'will use that package.json as default dependencies for the sample app',
    false
  )
  .arguments('[packages...]')
  .action((packages) => {
    if (packages) {
      packagesToAdd = packages;
    }
  })
  .parse(process.argv);

if (packagesToAdd && packagesToAdd.length === 0) {
  console.error('You must provide at least one package to add.');
  process.exit(1);
}

(async () => {
  let reactNativeVersion = 'latest';
  let dependenciesWithoutReact = [];
  let existingDependenciesNames = [];
  let tempDirectory = null;
  let clearTempDirectory = null;

  if (program.packageJson !== false) {
    const pathToPackageJson =
      program.packageJson === true
        ? path.resolve(process.cwd(), 'package.json')
        : program.packageJson;

    await action(
      `Reading package.json ${
        program.debug ? chalk.green(pathToPackageJson) : ''
      }`,
      new Promise((resolve, reject) => {
        fs.readFile(pathToPackageJson, 'UTF-8', (error, data) => {
          if (error) {
            reject(error);
          }

          dependencies = JSON.parse(data).dependencies;
          dependenciesWithoutReact = Object.entries(dependencies).filter(
            ([key]) => key !== 'react-native' && key !== 'react'
          );
          existingDependenciesNames = Object.values(
            dependenciesWithoutReact
          ).map(([packageName]) => packageName);

          reactNativeVersion = dependencies['react-native'];

          if (reactNativeVersion == null) {
            console.log('This is not a React Native project.');
            reject();
          }

          resolve(`Found react-native@${reactNativeVersion}`);
        });
      })
    );
  }

  await action(
    'Creating a temporary directory',
    new Promise((resolve, reject) => {
      tmp.dir((error, directoryPath, removeCallback) => {
        if (error) {
          reject(error);
        }

        tempDirectory = `${directoryPath}/BundleSize`;
        clearTempDirectory = removeCallback;

        resolve(program.debug === true ? chalk.blue(tempDirectory) : undefined);
      });
    })
  );

  await action(
    `Creating a sample app with react-native@${reactNativeVersion}`,
    execa(
      `npx --yes react-native@${reactNativeVersion} init BundleSize --directory ${tempDirectory} ${
        reactNativeVersion !== 'latest' ? `--version ${reactNativeVersion}` : ''
      }`,
      {
        shell: true,
      }
    )
  );

  if (program.packageJson !== false) {
    await action(
      `Adding ${dependenciesWithoutReact.length} dependencies from your package.json to the sample app`,
      execa(
        `yarn add ${dependenciesWithoutReact
          .map(([key, value]) => `${key}@"${value}"`)
          .join(' ')}`,
        {
          cwd: tempDirectory,
          shell: true,
        }
      )
    );

    await action(
      `Importing ${dependenciesWithoutReact.length} dependencies from your packages.json to the sample app`,
      new Promise((resolve, reject) =>
        prependFile(
          `${tempDirectory}/index.js`,
          `${dependenciesWithoutReact.map(
            ([packageName], index) =>
              `import * as OriginalPackage${index} from '${packageName}';`
          ).join(`
`)}
`,
          (err) => {
            if (err) {
              reject(err);
            }

            resolve();
          }
        )
      )
    );
  }

  await action(
    'Bundling sample app',
    execa(
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
        'original.jsbundle',
        '--sourcemap-output',
        'original.map',
      ],
      { cwd: tempDirectory }
    )
  );

  await action(
    `Adding ${packagesToAdd.join(' ')}`,
    execa(`yarn add ${packagesToAdd.join(' ')}`, {
      cwd: tempDirectory,
      shell: true,
    })
  );

  await action(
    `Importing ${packagesToAdd.join(' ')}`,
    new Promise((resolve, reject) =>
      prependFile(
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
`,
        (err) => {
          if (err) {
            reject(err);
          }

          resolve();
        }
      )
    )
  );

  await action(
    'Bundling sample app again',
    execa(
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
        'withPackages.jsbundle',
        '--sourcemap-output',
        'withPackages.map',
      ],
      { cwd: tempDirectory }
    )
  );

  await action(
    'Comparing size of bundles',
    new Promise((resolve, reject) => {
      Promise.all([
        new Promise((statsResolve) =>
          fs.stat(`${tempDirectory}/original.jsbundle`, [], (err, stats) => {
            if (err) {
              reject(err);
            }

            statsResolve(stats.size);
          })
        ),
        new Promise((statsResolve) =>
          fs.stat(
            `${tempDirectory}/withPackages.jsbundle`,
            [],
            (err, stats) => {
              if (err) {
                reject(err);
              }

              statsResolve(stats.size);
            }
          )
        ),
      ]).then(([originalSize, polyfillSize]) => {
        resolve(
          () => `
📦 The original bundle is: ${chalk.bold(filesize(originalSize))}
📦 The bundle with ${packagesToAdd.join(' ')} is: ${chalk.bold(
            filesize(polyfillSize)
          )}
⚖️  Therefore, ${packagesToAdd.join(' ')} adds ${chalk.bold.red(
            filesize(polyfillSize - originalSize)
          )} to the JavaScript bundle`
        );
      });
    })
  );

  await action(
    'Generating sources map explorer',
    new Promise((resolve) => {
      const { name: sourceMapOutputDirectory } = tmp.dirSync();

      Promise.all([
        Promise.resolve(
          generateSourceMapExplorer(
            'original',
            tempDirectory,
            sourceMapOutputDirectory
          )
        ),
        Promise.resolve(
          generateSourceMapExplorer(
            'withPackages',
            tempDirectory,
            sourceMapOutputDirectory
          )
        ),
      ]).then(([originalOutput, withPackagesOutput]) => {
        resolve();

        setTimeout(() => {
          console.log(
            'Original source map explorer:',
            chalk.underline(originalOutput)
          );

          console.log(
            `With ${packagesToAdd.join(' ')}:`,
            chalk.underline(withPackagesOutput)
          );
        });
      });
    })
  );

  if (!program.debug) {
    clearTempDirectory();
  }
})();
