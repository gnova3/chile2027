# Chile 2027

Gabriel & Alex’s bilingual trip calendar and shared photo book, 17 January–8 February 2027. Static website on GitHub Pages; private data, authentication and photo storage on Supabase Free.

## Features

- English / Spanish interface and public activity titles.
- Weekly calendar with colour categories and Santiago time, independent of visitor timezone.
- Private meeting requests with name, email, time, duration, topic, city and message.
- Sole-administrator review, approval, decline, editing and cancellation. Approved meetings expose only time, topic, category and city. Conflicting confirmed meetings are rejected transactionally.
- Private holiday suggestions. Gabriel edits bilingual public text, publishes/unpublishes plans and opens/closes informal three-option polls.
- Public photo submissions, client-side resizing/re-encoding and approval before publication. Files remain in a private bucket with policy-controlled signed URLs.
- Anonymous visitors need no account. The app creates a temporary authenticated identity when submitting or voting.

## Run locally

`npm ci --ignore-scripts`, `npm test`, then `npm run dev`. Open http://127.0.0.1:4173.

## Deployment

1. Create a dedicated free Supabase project. Keep Data API enabled, turn off automatic table grants, and enable RLS by default.
2. Apply `supabase/schema.sql` once in its SQL editor.
3. Enable anonymous sign-ins under Authentication. Create the sole administrator as a **verified permanent user** through the dashboard. Add that user's UUID to `trip_private.admins` using the SQL editor. Do not grant visitors access to this table or schema. Never assign admin status from client-editable profile metadata.
4. Configure `public/config.js` with the project URL and public publishable/anon key. Never use a secret or service-role key. Both values are intended for browser use; database authorization is enforced by SQL functions and storage policies.
5. Select GitHub Actions in repository Settings → Pages. Push to `main`; the workflow tests before publishing `public/` only. The booking screenshot is deliberately excluded from the repository and published assets.
6. Verify the live site with two independent browser sessions: submit, approve, publish, vote, upload and reject. SQL tests use PGlite with mocked Supabase auth/storage tables, so a live smoke test remains necessary.

## Privacy and free-tier limits

Private tables live in the unexposed `trip_private` schema, have RLS enabled and no visitor grants. All data access is through narrowly scoped functions. Public output explicitly selects safe columns. Admin status is tied to a server-side UUID allowlist. The front-end never downloads private records for public views.

Uploads are JPEG-only in storage, at most 2 MB, with a hard cap of 300 upload reservations (at most 600 MB) to leave room within the free tier's 1 GB storage. Each identity can submit at most 20 items per rolling 24 hours. Failed reservations and rejected photos count toward the cap; an administrator can review and remove unused objects/records through the Supabase dashboard to reclaim capacity. Existing signed image links can remain valid for up to 10 minutes after rejection.

Anonymous polls are informal: one vote per temporary browser identity. Clearing a session or using another browser permits a new identity, so this is not a verified one-person-one-vote system. For stronger abuse protection, configure Supabase CAPTCHA and add its token to anonymous sign-in before distributing the site widely. Per-identity limits do not stop determined attackers creating multiple identities. The hard storage cap limits storage growth but not bandwidth consumption.

Free Supabase projects may pause during inactivity and have usage limits. Check the project before the trip; never silently upgrade to a paid plan. No email notifications are implemented: requests are managed in the private dashboard, and Gabriel contacts guests using their submitted email.

## Tests

`npm test` verifies timezone conversion, trip bounds, escaping, private table access, administrator authorization, safe public output, meeting conflicts, idea publication, poll lifecycle and deduplication, private photo storage policies, cancellation and submission rate limits.
