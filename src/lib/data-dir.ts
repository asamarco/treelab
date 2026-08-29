import path from 'path';

/**
 * Returns the resolved absolute path to the application's data directory.
 * Uses `/*turbopackIgnore: true*\/` to prevent Turbopack's static analysis
 * from tracing the entire project root due to dynamic process.env.DATA_DIR resolution.
 */
export function getDataDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR || 'data');
}
