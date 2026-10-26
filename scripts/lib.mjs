// What the setup scripts share: a masked prompt, giving a Worker a secret, the intake's address.
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deployedUrl } from '../src/setup/deploy.mjs';

/** Reads one line; in a terminal, each typed character shows as *. */
export function askSecret(prompt) {
  process.stdout.write(prompt);
  const { stdin } = process;
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    return new Promise((resolve) => rl.once('line', (line) => { rl.close(); resolve(line.trim()); }));
  }
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

/** `wrangler secret put`, the value on stdin: never on a command line, never printed. */
export function putSecret(name, value, { config, cwd } = {}) {
  const run = spawnSync(`npx wrangler secret put ${name}${config ? ` -c ${config}` : ''}`, { shell: true, cwd, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  return run.status === 0;
}

/** The intake Worker's address: --url=… if given, else the one the last `npm run deploy` published. */
export function intakeUrl() {
  const given = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length);
  if (given) return given.replace(/\/+$/, '');
  const file = fileURLToPath(new URL('../.wrangler/deploy-intake.ndjson', import.meta.url));
  return existsSync(file) ? deployedUrl(readFileSync(file, 'utf8')) : null;
}
