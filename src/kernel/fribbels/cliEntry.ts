/**
 * The entry point of the bundled command (`dist/cli.js`, vite.config.cli.ts). It lives here because it is the one file that
 * imports the Fribbels adapter, which is type-checked with Fribbels' own compiler options (tsconfig.fribbels.json).
 * Everything else is in src/cli.ts.
 */
import { main } from '../../cli'
import { FribbelsKernel } from './fribbelsKernel'

process.exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  kernel: () => new FribbelsKernel(),
})
