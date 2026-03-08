// src/utils/logger.js
// Pretty-printed, colored logger using chalk

import chalk from 'chalk';

const timestamp = () => chalk.gray(`[${new Date().toISOString()}]`);

export const logger = {
  info: (msg, detail = '') =>
    console.log(`${timestamp()} ${chalk.cyan('ℹ')} ${chalk.white(msg)} ${chalk.gray(detail)}`),

  success: (msg, detail = '') =>
    console.log(`${timestamp()} ${chalk.green('✔')} ${chalk.greenBright(msg)} ${chalk.gray(detail)}`),

  warn: (msg, detail = '') =>
    console.log(`${timestamp()} ${chalk.yellow('⚠')} ${chalk.yellow(msg)} ${chalk.gray(detail)}`),

  error: (msg, detail = '') =>
    console.log(`${timestamp()} ${chalk.red('✖')} ${chalk.redBright(msg)} ${chalk.gray(detail)}`),

  step: (n, total, msg) =>
    console.log(`\n${timestamp()} ${chalk.bgBlue.white(` STEP ${n}/${total} `)} ${chalk.bold.white(msg)}\n`),

  divider: () =>
    console.log(chalk.gray('─'.repeat(70))),

  ai: (msg) =>
    console.log(`${timestamp()} ${chalk.magenta('🤖 AI')} ${chalk.magentaBright(msg)}`),
};
