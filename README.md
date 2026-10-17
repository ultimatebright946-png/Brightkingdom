# Bright Kingdom WhatsApp Bot

A WhatsApp group bot with a React dashboard, QR/pair-code linking, ranks, and group moderation commands. This uses Baileys, an unofficial WhatsApp Web client library; WhatsApp can change its protocol or restrict accounts using unofficial clients. Use only with a group and account you control, and get members' consent before moderation or automation.

## Important deployment notes

- Deploy the backend on Render from `render.yaml` (Blueprint). It needs a persistent disk because WhatsApp session credentials and rank data must survive restarts. The included disk costs money on Render; check current pricing before deploying.
- Deploy the `frontend` directory as a Vercel project. Set `VITE_API_URL` to your Render service URL (for example `https://bright-kingdom-api.onrender.com`).
- In Render, set `FRONTEND_URL` to your exact Vercel origin (for example `https://your-project.vercel.app`).
- Render generates `DASHBOARD_KEY` in the Blueprint. Copy that value into the dashboard's Dashboard key field. Do not share it or commit it to GitHub.
- On the first successful WhatsApp connection, the account is assigned the King rank. Keep the Render disk and dashboard key private.

## Local development

Terminal 1:
```bash
cd backend
npm install
npm start
```

Terminal 2:
```bash
cd frontend
npm install
npm run dev
```

For local dashboard access, set `DASHBOARD_KEY` in the backend environment and `VITE_API_URL=http://localhost:3000` in `frontend/.env.local`, then restart Vite. Open the Vite URL printed in the terminal.

## Commands

- `.menu`, `.ranks`, `.myrank`, `.rank @user`
- King only: `.crown @user queen`, `.exile @user`
- Group admins: `.vap @user`, `.d @user`, `.p @user`, `.paralyse`, `.unparalyse`, `.mute @user 10m`, `.unmute @user`

Mention a member or reply to one of their messages to target them. Bot must be a group admin for moderation operations. Mutes are in-memory and reset when the backend restarts; WhatsApp does not provide a native timed mute for ordinary members, so this bot implements mute by deleting their messages while active and requires the bot to have permission to delete messages.

## Corrections from the supplied draft

1. The original backend had a syntax error in `/api/status` (`king` object property was missing a closing brace), and the frontend had a missing `)` in the ranks fetch call.
2. `render.yaml` indentation/schema was invalid; Render Blueprint uses `runtime`, nested `envVars`, and a persistent disk for auth/session data.
3. Render and Vercel are separate services. Render does not automatically deploy the Vite frontend, and Vercel does not automatically know the Render API URL. Configure `VITE_API_URL` and `FRONTEND_URL` explicitly.
4. The original code exposed QR, pairing, ranks, and status endpoints without authentication. This version protects dashboard endpoints with `DASHBOARD_KEY`.
5. The original bot allowed any group member to invoke kick/promote/demote/lock/mute commands. This version checks group-admin status for moderation commands and limits crown/exile to the configured King.
6. `express.static('../frontend/dist')` is relative to the process working directory and the frontend was not built in Render. The frontend is now deployed separately on Vercel.
7. The original pairing route could start multiple sockets and return before a code existed. This version has a startup guard and waits briefly for a code.
8. The original reconnect flow could restart while a prior socket was still initializing. Reconnect is delayed and startup is guarded, but Baileys behavior can still change with upstream versions.
9. The draft claimed “one-click” and “will work.” Deployment still requires creating GitHub/Render/Vercel projects and setting the environment variables above. A Git push alone does not create those accounts or configure secrets.

## Git push

Create a GitHub repository, then from this folder:
```bash
git init
git add .
git commit -m "Bright Kingdom bot and dashboard"
git branch -M main
git remote add origin https://github.com/YOURNAME/bright-kingdom-bot.git
git push -u origin main
```
