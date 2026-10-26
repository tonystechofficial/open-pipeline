// The public intake Worker: Cal.com bookings, the receptionist's calls and the website form, each
// checked by its own proof (src/server/intake-http.mjs). It writes to the app's D1 database.
import config from '../config/pipeline.json';
import { d1Store } from '../src/db/store.mjs';
import { handleIntake, verifyTurnstile } from '../src/server/intake-http.mjs';

export default {
  fetch(request, env) {
    return handleIntake(request, {
      store: d1Store(env.DB, config),
      config,
      secrets: { calcom: env.CALCOM_WEBHOOK_SECRET, receptionist: env.RECEPTIONIST_SECRET, turnstile: env.TURNSTILE_SECRET },
      formOrigins: String(env.FORM_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
      verifyTurnstile: (token, ip) => verifyTurnstile(env.TURNSTILE_SECRET, token, ip),
    });
  },
};
