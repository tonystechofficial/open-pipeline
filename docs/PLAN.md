# open-pipeline: plan of the first version

A small sales pipeline for a one-person business, hosted on the Cloudflare free tier, built first for
Tony's Tech and configurable for others. Decided with the owner on 2026-10-26.

## Scope of the first version

| Feature | In v1 |
|---|---|
| Contacts and their business, with their whole history | yes |
| Deals moving through a pipeline of stages (drag and drop) | yes |
| Tasks and reminders: every open deal has a next action and a date | yes |
| Notes on calls, meetings and emails, in a timeline | yes |
| Custom fields (trade, missed calls, the five qualification questions, offer, amounts) | yes |
| Intake: Cal.com bookings, receptionist calls, website form, CSV import | yes |
| Morning email: overdue and due follow-ups, deals left without a next action | yes |
| Email templates and follow-up sequences, saved segments, reports | later |

## Stages

Configured in `config/pipeline.json`; cold, warm and hot follow from the stage.

| Stage | Temperature |
|---|---|
| Nouveau | cold |
| Contacté | cold |
| RDV pris | warm |
| Qualifié | hot |
| Proposition envoyée | hot |
| Pilote signé | won |
| En service | won, closed |
| Perdu / Plus tard | closed, with a reason and an optional date to get back in touch |

## Architecture

Two Workers on one D1 database, created in the EU jurisdiction:

- **open-pipeline**, the app (pages and API), behind **Cloudflare Access** (Worker-level policy).
  Cloudflare authenticates every request before the Worker runs, and the Worker refuses any request
  without `ctx.access`, so it fails closed if Access is ever turned off. The pages are served by the
  Worker itself, not by Static Assets, because Static Assets do not pass `ctx.access` to the Worker.
  A daily cron sends the morning email and deletes contacts untouched for three years.
- **open-pipeline-intake**, public, with only the receiving endpoints, each with its own proof:
  - `POST /intake/calcom`: Cal.com booking webhooks, signed (`x-cal-signature-256`, HMAC-SHA256 of the
    raw body);
  - `POST /intake/receptionist`: the end of each open-receptionist call, with a shared secret;
  - `POST /intake/form`: the website form, with a Cloudflare Turnstile token and an origin allow-list.

Access cannot leave one path of a Worker public, hence the second Worker. Zero dependencies, Node's
test runner, the D1 SQL tested on Node's SQLite, as in open-receptionist.

## Data

`contacts` (person and their business: name, phone, email, company, trade, town; one prospect is one
small business in v1), `deals` (stage, offer, amounts, custom fields as JSON, lost reason),
`tasks` (title, due date, done), `activities` (note, call, meeting, email, booking, form, stage change,
import), each intake activity keyed by its source id so a redelivered webhook is recorded once.
A new intake finds the contact by phone, then by email, and adds to its open deal, or opens one.

## Screens (French)

Pipeline board; deal page (contact, fields, tasks, timeline, note box); tasks (overdue, today,
coming, deals without a next action); new deal; CSV import with a preview. Mobile first.

## Commands

`npm run db:id`, `db:init`, `deploy` (both Workers, then `README.local.md`), `cal:webhook` (creates
the Cal.com webhook and its secret), `intake:secret` (a shared secret for the receptionist).

## Only the owner can do

Turn on Zero Trust and protect the `open-pipeline` Worker in the dashboard (one Worker only, never
"Protect all Workers", which would lock the receptionist's webhooks too); give the Resend key for the
morning email; create the Turnstile widget for the website form; run `cal:webhook` with the Cal.com key.
