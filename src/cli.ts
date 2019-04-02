import path from 'path';
import fs from 'fs-extra';
import yargs from 'yargs';
import inquirer from 'inquirer';
import cosmiconfig from 'cosmiconfig';
import isGitDirty from 'is-git-dirty';
import * as logger from './utils/logger';
import buildCommonJS from './targets/commonjs';
import buildModule from './targets/module';
import { Options } from './types';

const { name } = require('../package.json');
const root = process.cwd();
const explorer = cosmiconfig(name);

yargs
  .command('init', 'configure the package to use bob', {}, async () => {
    const pak = path.join(root, 'package.json');

    if (isGitDirty()) {
      const { shouldContinue } = await inquirer.prompt({
        type: 'confirm',
        name: 'shouldContinue',
        message: `The working directory is not clean. You should commit or stash your changes before configuring bob. Continue anyway?`,
        default: false,
      });

      if (!shouldContinue) {
        process.exit(1);
      }
    }

    if (!(await fs.pathExists(pak))) {
      logger.exit(
        `Couldn't find a 'package.json' file in ${pak}. Are you in a project folder?`
      );
    }

    const pkg = JSON.parse(await fs.readFile(pak, 'utf-8'));
    const { source, output, targets, flow } = await inquirer.prompt([
      {
        type: 'input',
        name: 'source',
        message: 'Where are your source files?',
        default: 'src',
        validate: input => Boolean(input),
      },
      {
        type: 'input',
        name: 'output',
        message: 'Where do you want to generate the output files?',
        default: 'lib',
        validate: input => Boolean(input),
      },
      {
        type: 'checkbox',
        name: 'targets',
        message: 'Which targets do you want to build?',
        choices: ['commonjs', 'module'],
        validate: input => Boolean(input.length),
      },
      {
        type: 'confirm',
        name: 'flow',
        message: 'Do you want to publish definitions for flow?',
        default: Object.keys(pkg.devDependencies || {}).includes('flow-bin'),
      },
    ]);

    const target = targets[0];
    const entries = {
      main: path.join(output, target, 'index.js'),
      module: path.join(output, 'module', 'index.js'),
      'react-native': path.join(source, 'index.js'),
    };

    const prepare = 'bob build';
    const files = [source, output];

    for (const key in entries) {
      // @ts-ignore
      const entry = entries[key] as string;

      if (pkg[key] && pkg[key] !== entry) {
        const { replace } = await inquirer.prompt({
          type: 'confirm',
          name: 'replace',
          message: `Your package.json has the '${key}' field set to '${
            pkg[key]
          }'. Do you want to replace it with '${entry}'?`,
          default: true,
        });

        if (replace) {
          pkg[key] = entry;
        }
      } else {
        pkg[key] = entry;
      }
    }

    if (pkg.scripts && pkg.scripts.prepare && pkg.scripts.prepare !== prepare) {
      const { replace } = await inquirer.prompt({
        type: 'confirm',
        name: 'replace',
        message: `Your package.json has the 'scripts.prepare' field set to '${
          pkg.scripts.prepare
        }'. Do you want to replace it with '${prepare}'?`,
        default: true,
      });

      if (replace) {
        pkg.scripts.prepare = prepare;
      }
    } else {
      pkg.scripts = pkg.scripts || {};
      pkg.scripts.prepare = prepare;
    }

    if (pkg.files) {
      const { replace } = await inquirer.prompt({
        type: 'confirm',
        name: 'replace',
        message: `Your package.json already has a 'files' field. Do you want to replace it?`,
        default: true,
      });

      if (replace) {
        pkg.files = files;
      }
    } else {
      pkg.files = files;
    }

    pkg[name] = {
      source,
      output,
      targets: targets.map((t: string) => {
        if (t === target && flow) {
          return [t, { flow }];
        }

        return t;
      }),
    };

    await fs.writeFile(pak, JSON.stringify(pkg, null, 2));

    const gitignore = path.join(root, '.gitignore');

    if (await fs.pathExists(gitignore)) {
      const content = await fs.readFile(gitignore, 'utf-8');

      if (!content.split('\n').includes(`${output}/`)) {
        await fs.writeFile(
          gitignore,
          `${content}\n# generated by bob\n${output}/\n`
        );
      }
    }

    console.log('🎉 Your project is configured!');
  })
  .command('build', 'build files for publishing', {}, async argv => {
    const result = explorer.searchSync();

    if (!(result && result.config)) {
      logger.exit(
        `No configuration found. Run '${
          argv.$0
        } init' to create one automatically.`
      );
    }

    const options: Options = result!.config;

    if (!(options.targets && options.targets.length)) {
      logger.exit(
        `No targets found in the configuration in '${path.relative(
          root,
          result!.filepath
        )}'.`
      );
    }

    const source = options.source;

    if (!source) {
      logger.exit(
        `No source option found in the configuration in '${path.relative(
          root,
          result!.filepath
        )}'.`
      );
    }

    const output = options.output;

    if (!output) {
      logger.exit(
        `No source option found in the configuration in '${path.relative(
          root,
          result!.filepath
        )}'.`
      );
    }

    for (const target of options.targets!) {
      const targetName = Array.isArray(target) ? target[0] : target;
      const targetOptions = Array.isArray(target) ? target[1] : undefined;

      switch (targetName) {
        case 'commonjs':
          await buildCommonJS({
            root,
            source: source as string,
            output: path.resolve(root, output as string, 'commonjs'),
            options: targetOptions,
          });
          break;
        case 'module':
          await buildModule({
            root,
            source: source as string,
            output: path.resolve(root, output as string, 'module'),
            options: targetOptions,
          });
          break;
        default:
          logger.exit(`Invalid target '${target}'.`);
      }
    }
  })
  .strict().argv;
