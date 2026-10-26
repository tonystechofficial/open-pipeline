// The app Worker: the pages and the API behind Cloudflare Access, and the morning run (cron).
// The pages are bundled as text (the [[rules]] of wrangler.toml) and served from here, not from
// Static Assets, which would not pass ctx.access on.
import html from '../ui/index.html';
import css from '../ui/app.css';
import js from '../ui/app.client.js';
import config from '../config/pipeline.json';
import { validatePipeline } from '../src/core/pipeline.mjs';
import { d1Store } from '../src/db/store.mjs';
import { handleApp } from '../src/server/app.mjs';
import { runDaily, resendSender } from '../src/server/daily.mjs';

const { errors } = validatePipeline(config);

export default {
  fetch(request, env, ctx) {
    if (errors.length) {
      console.error('[open-pipeline] config/pipeline.json:', errors.join(' ; '));
      return new Response('Configuration invalide : voir npm run tail.', { status: 500 });
    }
    return handleApp(request, { store: d1Store(env.DB, config), config, assets: { html, css, js }, access: ctx.access });
  },

  async scheduled(controller, env) {
    const outcome = await runDaily({
      store: d1Store(env.DB, config),
      config,
      now: new Date(controller.scheduledTime),
      sendEmail: env.RESEND_API_KEY ? resendSender({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }) : null,
      to: env.REMINDER_EMAIL,
      appUrl: env.APP_URL,
    });
    console.log('[open-pipeline] morning run', JSON.stringify(outcome));
  },
};
