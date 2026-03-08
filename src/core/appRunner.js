// src/core/appRunner.js
// Runs the application locally and captures stdout/stderr

import { execa } from 'execa';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Run the configured test/start command inside `localPath`.
 * Returns { success: boolean, output: string }
 */
export async function runApplication(localPath) {
  const [cmd, ...args] = config.agent.appStartCommand.split(' ');

  logger.info('Running application…', config.agent.appStartCommand);

  try {
    const result = await execa(cmd, args, {
      cwd: localPath,
      timeout: config.agent.appTimeoutMs,
      all: true,        // merge stdout + stderr into result.all
      reject: false,    // don't throw on non-zero exit
      shell: true,
    });

    const output = result.all || '';
    const success = result.exitCode === 0;

    if (success) {
      logger.success('Application ran successfully');
    } else {
      logger.error('Application exited with errors', `exit code ${result.exitCode}`);
    }

    return { success, output };
  } catch (err) {
    // Usually a timeout
    const output = err.all || err.message || 'Unknown error';
    logger.error('Application runner threw an exception', err.message);
    return { success: false, output };
  }
}
