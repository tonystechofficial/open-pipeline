// The intake Worker's routes: public, so each checks its own proof before touching anything, and an
// endpoint whose secret is not set refuses everything.
//  - POST /intake/calcom        Cal.com webhook, x-cal-signature-256 (HMAC-SHA256 of the raw body)
//  - POST /intake/receptionist  open-receptionist's end of call, x-pipeline-secret
//  - POST /intake/form          the website form: allowed origin, Cloudflare Turnstile, a honeypot
import { fromCalBooking, fromReceptionistCall, fromForm } from '../core/intake.mjs';
import { verifyHmacSha256, safeEqual } from '../core/signature.mjs';
import { json } from './http.mjs';

const MAX_BODY = 200_000;

export async function handleIntake(request, deps) {
  const url = new URL(request.url);
  const path = url.pathname;
  const now = deps.now ? deps.now() : new Date();
  const log = deps.log ?? ((...a) => console.error('[open-pipeline-intake]', ...a));

  try {
    if (request.method === 'GET' && path === '/health') return json({ ok: true });

    if (path === '/intake/form') return form(request, deps, now);

    if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
    const raw = (await request.text()).slice(0, MAX_BODY);

    if (path === '/intake/calcom') {
      if (!deps.secrets?.calcom) return json({ error: 'not configured' }, 503);
      if (!await verifyHmacSha256(deps.secrets.calcom, raw, request.headers.get('x-cal-signature-256'))) return json({ error: 'bad signature' }, 401);
      const result = fromCalBooking(JSON.parse(raw), deps.config);
      if (result.ignored) return json({ ignored: true });
      return json(await deps.store.applyIntake(result.intake, { now }));
    }

    if (path === '/intake/receptionist') {
      if (!deps.secrets?.receptionist) return json({ error: 'not configured' }, 503);
      if (!safeEqual(request.headers.get('x-pipeline-secret') ?? '', deps.secrets.receptionist)) return json({ error: 'unauthorized' }, 401);
      const result = fromReceptionistCall(JSON.parse(raw), deps.config);
      if (result.ignored) return json({ ignored: true });
      return json(await deps.store.applyIntake(result.intake, { now }));
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    log(error);
    return json({ error: 'internal error' }, 500);
  }
}

async function form(request, deps, now) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (deps.formOrigins ?? []).includes(origin);
  const cors = allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  if (request.method === 'OPTIONS') {
    return allowed
      ? new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } })
      : new Response(null, { status: 403 });
  }
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (!allowed) return json({ error: 'origin not allowed' }, 403);
  if (!deps.secrets?.turnstile) return json({ error: 'Le formulaire n’est pas encore ouvert.' }, 503, cors);

  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, MAX_BODY));
  } catch {
    return json({ error: 'Requête invalide.' }, 400, cors);
  }
  if (body?.website) return json({ ok: true }, 200, cors); // the honeypot: only robots fill a hidden field
  const human = await deps.verifyTurnstile(body?.turnstileToken, request.headers.get('cf-connecting-ip'));
  if (!human) return json({ error: 'Vérification anti-robot échouée : rechargez la page et réessayez.' }, 403, cors);

  const { intake, error } = fromForm(body, deps.config, { at: now.toISOString() });
  if (error) return json({ error }, 400, cors);
  await deps.store.applyIntake(intake, { now });
  return json({ ok: true }, 200, cors);
}

/** Cloudflare Turnstile's server-side check. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ */
export async function verifyTurnstile(secret, token, ip, fetchImpl = fetch) {
  if (!secret || !token) return false;
  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}
