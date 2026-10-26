// What `npm run deploy` reads and writes. Pure; scripts/deploy.mjs runs wrangler and writes the files.
// Wrangler writes each deploy's addresses to WRANGLER_OUTPUT_FILE_PATH, one JSON entry per line.

/** The Worker's origin from one address, or null. https only: workers.dev has no http. */
function origin(raw) {
  try {
    const url = new URL(String(raw).trim());
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.origin : null;
  } catch {
    return null;
  }
}

/** The address of the last deploy in wrangler's output file, the workers.dev one first. */
export function deployedUrl(ndjson) {
  const entries = String(ndjson ?? '').split(/\r?\n/).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  });
  const last = entries.filter((e) => e?.type === 'deploy').at(-1);
  const urls = (last?.targets ?? []).map(origin).filter(Boolean);
  return urls.find((u) => u.endsWith('.workers.dev')) ?? urls[0] ?? null;
}

/**
 * A [vars] value written in place, its comment and the line endings kept. A line commented out in a
 * template (`# NAME = ""`) is turned on; a missing one is added right under [vars].
 */
export function setVar(toml, name, value) {
  const active = new RegExp(`^(${name}\\s*=\\s*")([^"]*)(")`, 'm');
  const commented = new RegExp(`^#\\s*(${name}\\s*=\\s*")([^"]*)(")`, 'm');
  const write = (line) => toml.replace(line, (_, start, _old, end) => `${start}${value}${end}`);
  const current = toml.match(active);
  if (current) return current[2] === value ? { toml, changed: false } : { toml: write(active), changed: true };
  if (commented.test(toml)) return { toml: write(commented), changed: true };
  const header = toml.match(/^\[vars\][^\S\r\n]*(\r?\n)/m);
  if (!header) return { error: `No [vars] section to write ${name} into.` };
  const at = header.index + header[0].length;
  return { toml: `${toml.slice(0, at)}${name} = "${value}"${header[1]}${toml.slice(at)}`, changed: true };
}

export function databaseIdMissing(toml) {
  return /^database_id\s*=\s*"(REPLACE_WITH_D1_DATABASE_ID)?"/m.test(toml);
}

export function localReadme({ appUrl, intakeUrl }) {
  return `# My deployment: the next steps

Written by \`npm run deploy\`, ignored by git (\`*.local.md\`).

- App, behind Cloudflare Access: **${appUrl}**
- Intake, public: **${intakeUrl}**

Secrets never go in this file: type them in the terminal when asked.

## 1. Lock the app with Cloudflare Access (once)

Until then the app answers "Accès réservé" to everyone, you included: it refuses every request that
Access did not let through.

1. Cloudflare dashboard > **Zero Trust**. The first time, pick a team name and the **Free** plan.
2. **Workers & Pages** > **open-pipeline** > **Access** tab > **Protect this Worker behind Access**.
3. Choose **All traffic**, not "Previews only".
4. Authentication policy: **Cloudflare account**, the members of your Cloudflare account, that is you.
   Never **Email domain** with gmail.com: every Gmail address in the world could sign in.
5. **Apply Access**.

Protect this Worker only, and never **Protect all Workers**: that would also lock open-pipeline-intake
and open-receptionist, whose callers (Cal.com, Vapi, Twilio, your website) cannot sign in.

Open ${appUrl}: Cloudflare asks you to sign in, then the board opens.

## 2. The morning email

\`\`\`bash
npx wrangler secret put RESEND_API_KEY
\`\`\`

Then in the app: **Tâches** > **M'envoyer le récapitulatif maintenant**. With Resend's test sender
\`onboarding@resend.dev\` (MAIL_FROM), Resend delivers only to the address of your Resend account: put
that address in REMINDER_EMAIL (wrangler.toml), then \`npm run deploy\`.

## 3. Cal.com bookings

\`\`\`bash
npm run cal:webhook
\`\`\`

It asks for a Cal.com API key (Cal.com > Settings > Developer > API keys), creates the webhook to
${intakeUrl}/intake/calcom with a signing secret, and gives that secret to the intake Worker. Each new
booking then opens or updates a deal at "RDV pris".

## 4. The receptionist's calls

\`\`\`bash
npm run link:receptionist -- ../open-receptionist
\`\`\`

Then, in open-receptionist: \`npm run deploy\`. Each call that leaves a name or a number lands in
"Nouveau", or in "RDV pris" when the caller booked.

## 5. The website form

1. Cloudflare dashboard > **Turnstile** > **Add widget**: your site's hostname, mode **Managed**.
2. Give the intake Worker the widget's secret key:

   \`\`\`bash
   npx wrangler secret put TURNSTILE_SECRET -c wrangler.intake.toml
   \`\`\`

3. Put your site's address in FORM_ORIGINS (wrangler.intake.toml), then \`npm run deploy\`.
4. On the site, the form sends its fields and the widget's token to ${intakeUrl}/intake/form
   (README, "The website form").

## Check

\`\`\`bash
curl ${intakeUrl}/health
# {"ok":true}
npm run tail          # the app's logs, each morning run included
npm run tail:intake   # the intake's logs
\`\`\`

In PowerShell, type \`curl.exe\` instead of \`curl\`.
`;
}
