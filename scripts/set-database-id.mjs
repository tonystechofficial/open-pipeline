// Writes the id of the D1 database into wrangler.toml and wrangler.intake.toml, in place of
// REPLACE_WITH_D1_DATABASE_ID. Run it right after `wrangler d1 create`. The first time, it creates
// both files from their .example templates: git ignores them, they hold this deployment's values.
//
//   npm run db:id
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { planDatabaseId } from '../src/setup/wrangler-database-id.mjs';

let databases;
try {
  databases = JSON.parse(execSync('npx wrangler d1 list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
} catch {
  console.error('Could not list the D1 databases. Log in first: npx wrangler login');
  process.exit(1);
}

for (const name of ['wrangler.toml', 'wrangler.intake.toml']) {
  const file = new URL(`../${name}`, import.meta.url);
  const template = new URL(`../${name.replace(/\.toml$/, '.example.toml')}`, import.meta.url);
  const creating = !existsSync(file);
  const toml = readFileSync(creating ? template : file, 'utf8');
  const plan = planDatabaseId({ toml, databases, file: name });
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }
  if (creating || plan.toml !== toml) writeFileSync(file, plan.toml);
  if (creating) console.log(`Created ${name} from its .example template. Git ignores it: it holds this deployment's values.`);
  console.log(plan.message);
  if (plan.warning) console.warn(`Warning: ${plan.warning}`);
}
