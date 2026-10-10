# GWEEN setup: accounts, profiles and admin dashboard

The site is hosted on GitHub Pages, which is static hosting. The GWEEN version therefore uses Supabase for shared sign-in, profile names, and session-time statistics. Diary text is still encrypted in each user's browser and is not uploaded to Supabase.

## 1. Create a Supabase project

Create a project in Supabase and keep its database password private.

## 2. Create the database tables

Open **SQL Editor** in your Supabase project, create a new query, paste all of \`supabase/schema.sql\`, and run it.

The SQL sets up profile records, session usage records, a protected admin-membership table, and row-level security policies. Do not skip this step.

## 3. Set the public site URL for authentication

In Supabase, open **Authentication → URL Configuration**.

Set the Site URL to:

\`https://shalem046-cyber.github.io/writeyourdiary/\`

Add that same address to the allowed redirect URLs. Keep email confirmation enabled for accounts.

## 4. Add public client configuration to GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables**, and create these repository variables. The workflow also supports settings stored under **Settings → Environments → github-pages**:

- \`NEXT_PUBLIC_SUPABASE_URL\`: your Supabase Project URL
- \`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\`: your Supabase publishable key

These two values are meant for the browser. **Never use or add a \`service_role\` secret/key to this frontend or to these variables.** The website has only the public publishable key; table access is limited by the SQL row-level security policies.

The build job explicitly uses the `github-pages` environment, so variables and secrets stored there are available during the build. After adding them, open **Actions**, select **Deploy Next.js to GitHub Pages**, and run the workflow manually (or push a commit). The build now stops with a clear error if either value is missing rather than publishing the setup screen again. The published site shows a setup notice until these variables have been included in a new build.

## 5. Create your account and make it the admin

Open the published site, create your account using a name, unique username, email, and password, then confirm your email and sign in.

To give your account admin access, open Supabase **Authentication → Users** to confirm your email is present. In **SQL Editor**, run the following after replacing the sample email with your account email:

\`\`\`sql
insert into public.gween_admins(user_id)
select id from auth.users where lower(email) = lower('YOUR-EMAIL-HERE')
on conflict (user_id) do nothing;
\`\`\`

Sign out of GWEEN and sign back in. The **Admin dashboard** tab will appear. Do not add other users to \`gween_admins\` unless you intentionally want them to see member usernames and usage statistics.

## What the admin can see

The admin view displays each member's display name, username, signup date, last seen time, and approximate total active time. It does **not** query or reveal diary entries, drafts, private reflections, passwords, or email addresses.

Active-time statistics are approximate: the browser sends a heartbeat while the diary is open and visible. A tab crash, sleeping device, blocker, or network loss may delay the last-seen update.

## Diary privacy and recovery

Each user's diary is encrypted locally with AES-GCM and a key derived from their sign-in password. Diary text is not uploaded to Supabase. The diary is specific to the browser that holds it; it does not automatically sync between devices. If the password is changed or forgotten, a local diary encrypted with the old password may not be recoverable. Back up any important writing somewhere safe.

## GitHub Pages note

The repository builds a static export. Supabase handles account authentication and shared profile/usage records; there is no private server in this GitHub Pages site. Authorization is enforced by Supabase row-level security, not by hiding the Admin tab alone.

## After adding the GitHub variables

GitHub Actions embeds these public client settings into the static build. Adding or changing a repository variable does not retroactively alter an already-published build. Push a commit or rerun **Deploy Next.js to GitHub Pages** after configuring both variables. If the site still shows the setup screen after deployment, confirm the variable names match exactly and check that the SQL schema above was run successfully.
