# Toldos Live — Netlify version

A private family site: everyone finds themselves in the tree, then fills in what's missing —
Hebrew birthdays, photos, city, phone and email, spouse and children. It shows upcoming birthdays,
anniversaries and yahrzeits, has a "Who's this?" photo quiz, and prints a family book and a
birthday calendar as PDF. Hebrew and English.

**It's free, and can be used for any non-commercial use** (see [License](#license)).

It runs on [Netlify](https://netlify.com): the site, the photos, and the database (Netlify's own,
or your [Neon](https://neon.tech) database). It starts with an invented family, the Rosenfelds (42 people; nobody in it is real, and their portraits are AI-generated), which you
replace with your own.

**Try the demo: https://toldos-live.netlify.app** (password: `toldos`) — an invented family,
running entirely in your browser. Nothing you change there is saved anywhere else; "Start over" at
the bottom of a page puts it back. The demo's password is only there to show what it's like: your
real site opens with a password you choose and share with your family, checked on the server.
(Build a demo of your own with `npm run build:demo`: plain files for any static host.)

## Which version?

This is the **Netlify version**. The same site comes in two versions, with the same screens and
features and the same demo. They differ only in where it runs and the kind of database underneath:

| | [Cloudflare version](https://github.com/kadmonim/toldos-live-cloudflare) | [Netlify version](https://github.com/kadmonim/toldos-live-netlify) |
|---|---|---|
| Runs on | Cloudflare (a Worker) | Netlify (Functions) |
| Database | D1: SQLite, Cloudflare's own | Postgres: Netlify's own database, or your own Neon |
| Photos | R2 storage | Netlify Blobs |
| Accounts needed | One (Cloudflare) | Netlify, plus Neon if you choose it |
| Free plan | No logo on the site | A small Netlify logo on the site |
| Looking at the data | Cloudflare's console and `wrangler` commands | Any Postgres tool; with Neon, its console, branches and point-in-time restore |
| Changing the tables | Edit and run SQL by hand | Numbered migration files, applied by Netlify on each deploy |

Pick the one whose service you'd rather have an account with. If you already use Netlify, take the
Netlify version; if you're starting fresh and want one free account for everything, Cloudflare.
SQLite and Postgres are different databases, so switching versions later means copying the data
across (an AI assistant can do that with you); choosing well at the start saves that.

## The easy way: let Claude Code set it up

You don't need to know how any of this works. Setting this site up is also a good first project
for getting to know [Claude Code](https://claude.com/claude-code), an AI assistant that works in
your terminal:

1. Download this repository and open its folder in Claude Code.
2. Say something like:

   > Read the README and set this site up on my Netlify account, step by step. Tell me what
   > each step does, and ask me before anything that costs money. Then help me replace the invented
   > family with my own top couple.

Claude runs the commands below for you, explains them, and stops where it needs you (logging in
to Netlify, choosing the family password). The rest of this page is the same steps by hand.

## Try it first (nothing to set up)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints. This is a preview of the page only: it starts from
`data/family.json`, needs no password, and keeps changes in that browser.

To run the real thing on your computer (the functions, the photos and a local database), use
Netlify's own tool: `npx netlify dev`.

## Put it online

1. Put this code in a GitHub repository of your own (fork it, or download it and push it).
2. In Netlify: **Add new project → Import an existing project**, and pick that repository. The
   build settings come from `netlify.toml`; nothing to fill in.
3. **The database.** Netlify's own database (Netlify Database) is the simplest: it belongs to the
   site, and the files in `netlify/database/migrations/` (the tables, then the invented family)
   are applied by Netlify on each deploy.

   **Or your own [Neon](https://neon.tech) database**, for more flexibility. It's a second free
   account, but the database is then yours, apart from the site:
   - Neon's console: a SQL editor, a full history to restore from (point-in-time), and branches
     (a copy of the whole database to try something on).
   - Your AI assistant or any database tool can connect to it directly.
   - If you ever move the site to another host, the data stays where it is.

   To use it, set `TREE_DATABASE_URL` (step 4) to its connection string, and run the files in
   `netlify/database/migrations/` on it yourself, in order (in Neon's SQL Editor, or with
   `psql`), now and whenever a new one is added.
4. In **Project configuration → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | The password the family types to get in. Pick one and share it with them. |
   | `SESSION_SECRET` | Any long random text, e.g. from `openssl rand -base64 32`. Never shared. |
   | `TREE_DATABASE_URL` | Only with Neon: its connection string. |

5. **Deploys → Trigger deploy.** The site is then live at its `….netlify.app` address.

On Netlify's free plan the site shows a small Netlify logo; a paid plan doesn't. Your own address:
add a domain under **Domain management**. Nothing in the code needs the address.

## Make it yours

- **Family name and first language**: `netlify/lib/families.mjs` (the one entry there).
- **Your own family instead of the invented one**: start from a top couple (see
  [Choosing the top couple](#choosing-the-top-couple)). In
  `netlify/database/migrations/0002_family/migration.sql`, keep only two people and one couple
  with `is_root` = TRUE, with your names, before the first deploy; everyone else is added in the app. The top of the
  tree is only ever changed in the database: the app has no "add parents" button, on purpose.
- **Link preview picture** (what WhatsApp shows for a shared link): put a 1200×630 image in
  `public/` and name it in `families.mjs` as `og`.
- **The app admin**: `ADMIN` in `families.mjs` is a person in the tree. Exporting a branch is off
  for everyone; the app offers to ask the admin on WhatsApp, who turns it on for that person in the database:
  `UPDATE people SET can_export = true WHERE id = '<person id>';`
- **Someone who has passed away** is marked in the database, not in the app:
  `UPDATE people SET deceased = true WHERE id = '<id>';` (the id is in the address of their page).
- **`complete: true`** in `families.mjs`, once all the top couple's children are in: nobody can
  then be added as their child by mistake.
- **An Events tab** linking to a family calendar: build with `VITE_CALENDAR_URL` set.

## Choosing the top couple

Everything starts from one couple at the top: the site shows them, all their descendants, and
those descendants' husbands and wives. Nothing else is needed to decide who belongs.

- **Your grandparents** are the usual choice: the site then holds your parents, uncles and aunts,
  and all your first cousins and their families. That's a family that knows each other.
- **Your great-grandparents** bring in your parents' cousins and their families: a much bigger
  tree, and many people who don't know each other well.
- **Your parents** give a small tree: you, your brothers and sisters, and their families.

Pick the highest couple whose whole family you'd want on one site. Do it at the start: the app has
no "add parents" button, on purpose, so the top is only ever changed in the database.

## More than one family

Everyone has more than one family: your father's side, your mother's side, and once you're
married, your husband's or wife's side. One installation can serve them all, each as its own site
with its own address and password, from the same database:

- **Each family is a top couple.** Your father's parents are one, your mother's parents another.
  Your parents are in both: in the first as a child, in the second as a husband or wife.
- **A married couple belongs to both their families.** Your household (you, your spouse, your
  children) shows on your side's site and on your spouse's side's site, and it's the same record:
  a birthday or photo filled in on one site shows on the other.
- **Each site shows only its own family.** Someone on your wife's family's site sees her family,
  not yours.

To add a family:

1. **Put in its top couple**, and connect the person who links the two trees to them. For example,
   to add Chaya Rosenfeld's side (she was born Segal), insert her parents as a couple and set her
   `parents` to that couple:

   ```sql
   INSERT INTO people (id, he_first, en_first, he_last, en_last, sex) VALUES
     ('<new id 1>', 'משה', 'Moshe', 'סגל', 'Segal', 'm'),
     ('<new id 2>', 'רחל', 'Rochel', 'סגל', 'Segal', 'f');
   INSERT INTO couples (id, a, b) VALUES ('<new couple id>', '<new id 1>', '<new id 2>');
   UPDATE people SET parents = '<new couple id>' WHERE id = '<Chaya''s id>';
   ```

   (in the database's SQL console; ids are any new UUIDs, e.g. from
   `node -e "console.log(crypto.randomUUID())"`.)
2. **Add the family to `netlify/lib/families.mjs`**: its `key`, its names, its first language, the
   new couple's id as `root`, and its address in `hosts`.
3. **Give it an address.** The `….netlify.app` address shows the first family, so the others
   need a domain. Two ways to go about it:
   - **A domain for each family**: `rosenfeld.app` for one side, `segal.app` for the other. Each
     family gets a short address of its own name.
   - **One domain, a subdomain for each family**: buy one, like `ourfamily.app`, and use
     `rosenfeld.ourfamily.app`, `segal.ourfamily.app`, and so on. One domain to pay for, and as
     many families as you like.

   You can buy the domain through Netlify, or anywhere else. Then add each address to the site
   under **Domain management**, and put it in that family's `hosts` in `families.mjs`.
4. **Its own password** (optional): an environment variable `APP_PASSWORD_SEGAL` (the key in
   capitals). Without it, the family uses the shared `APP_PASSWORD`. A login on one family's site
   doesn't open another's.
5. Deploy (push to GitHub, or **Trigger deploy**).

The family then grows from its site: brothers, sisters, husbands, wives and children are all added
in the app. Claude Code can do all of these steps with you: tell it which family to add and who
connects it to the tree.

## How it's built

- **The page**: plain JavaScript built with Vite (`src/main.js`; `src/i18n.js` has every text in
  both languages; `src/hebrew.js` does Hebrew dates through `@hebcal/core`).
- **The server**: Netlify Functions in `netlify/functions/` (`tree.mjs` is the main one), and an
  edge function (`netlify/edge-functions/page.js`) that names the page for the family. Login is
  one family password and a signed cookie that lasts 90 days (`netlify/lib/auth.mjs`).
- **The data**: Postgres, through `netlify/lib/db.mjs`. The tree is built from couples: a
  person's `parents` is the couple they were born to. Tables: `people`, `couples`, `edits` (who
  filled in what) and `photos` (extra pictures). Each change to the tables is a new numbered
  folder in `netlify/database/migrations/`, numbered above the last one.
- **Photos and backups**: Netlify Blobs. Photos are shrunk in the browser before upload. Every
  night the whole database is saved as a JSON file (the last 30 are kept); `/api/backups` lists
  them.
- **Who is who**: after the password, each device says which person in the tree it is. That is
  trusted, not verified — this is built for a family that shares one password.

## Limits to know about

Netlify's free plan has monthly limits on function runs, bandwidth and storage; a family site is
usually well inside them. Check Netlify's pricing page for the current numbers.

## License

It's free, and can be used for any non-commercial use: setting it up for your own family,
changing it as you like, and sharing it with other families on the same terms. The terms are the
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
(`LICENSE.md`), with the notice in `NOTICE`.

**Commercial use is not allowed without permission** — for example selling it, hosting it for
families as a paid service, or building it into a product. If you see a business opportunity in
it, write to Kadmonim Studio at mendye@gmail.com and we can talk.

Not built yet, for anyone extending their own copy: a second copy of the photos (a nightly
mirror), undoing an edit from the saved `old`/`new` values in `edits`, and restoring a nightly
backup file into the database.
