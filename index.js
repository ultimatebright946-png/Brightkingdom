'use strict'
const express = require('express')
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const QRCode = require('qrcode')
const P = require('pino')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')

const app = express()
app.use(express.json({ limit: '20kb' }))
const allowedOrigin = process.env.FRONTEND_URL
app.use(cors({ origin: allowedOrigin ? allowedOrigin.split(',').map(x => x.trim()) : true }))

// Render persistent disk: set DATA_DIR=/var/data in render.yaml. Local runs use backend/data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })
const RANKS_FILE = path.join(DATA_DIR, 'ranks.json')
const AUTH_DIR = path.join(DATA_DIR, 'auth')
if (!fs.existsSync(RANKS_FILE)) fs.copyFileSync(path.join(__dirname, 'ranks.json'), RANKS_FILE)
let kingdom = JSON.parse(fs.readFileSync(RANKS_FILE, 'utf8'))
let qrData = null, pairCode = null, sock = null, starting = false
const mutedUsers = new Map()
const dashboardKey = process.env.DASHBOARD_KEY || ''
const save = () => fs.writeFileSync(RANKS_FILE, JSON.stringify(kingdom, null, 2))
const getRank = jid => {
  for (const [id, rank] of Object.entries(kingdom.ranks)) if (rank.users.includes(jid)) return { id, ...rank }
  return null
}
const isKing = jid => kingdom.ranks.king.users.includes(jid)
const requireDashboardKey = (req, res, next) => {
  if (!dashboardKey) return res.status(503).json({ error: 'Set DASHBOARD_KEY in backend environment before using dashboard actions.' })
  const supplied = req.get('x-dashboard-key') || req.query.key
  if (supplied !== dashboardKey) return res.status(401).json({ error: 'Unauthorized' })
  next()
}
const getText = message => message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || ''
const getTargets = m => {
  const context = m.message?.extendedTextMessage?.contextInfo || {}
  return { mentioned: context.mentionedJid || [], quoted: context.participant }
}
const isGroupAdmin = async (chatId, jid) => {
  try {
    const metadata = await sock.groupMetadata(chatId)
    const member = metadata.participants.find(p => p.id === jid)
    return Boolean(member?.admin)
  } catch { return false }
}

async function startBot(phone = null) {
  if (starting) return
  starting = true
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ['Bright Kingdom', 'Chrome', '1.0'] })
    sock.ev.on('creds.update', saveCreds)
    if (phone && !state.creds.registered) {
      try {
        pairCode = await sock.requestPairingCode(phone)
        console.log('Pairing code generated. Enter it in WhatsApp Linked Devices.')
      } catch (error) {
        console.error('Could not create pairing code:', error.message)
        pairCode = null
      }
    }
    sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
      if (qr) {
        try { qrData = await QRCode.toDataURL(qr) } catch (error) { console.error('QR generation failed:', error.message) }
      }
      if (connection === 'open') {
        qrData = null; pairCode = null
        console.log('Bright Kingdom connected')
        const jid = sock.user?.id
        if (jid && kingdom.ranks.king.users.length === 0) {
          kingdom.ranks.king.users = [jid]
          save()
          console.log('First connected account assigned King rank')
        }
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        if (code !== DisconnectReason.loggedOut) {
          starting = false
          setTimeout(() => startBot(), 4000)
        } else {
          qrData = null; pairCode = null; starting = false
          console.log('Logged out. Remove backend auth data and pair again to reconnect.')
        }
      }
    })
    sock.ev.on('messages.upsert', async ({ messages }) => {
      const m = messages?.[0]
      if (!m?.message || m.key.fromMe) return
      const text = getText(m.message).trim()
      if (!text.startsWith('.')) return
      const chatId = m.key.remoteJid
      const sender = m.key.participant || m.key.remoteJid
      if (!chatId?.endsWith('@g.us')) return

      const mutedUntil = mutedUsers.get(sender)
      if (mutedUntil && Date.now() < mutedUntil) {
        try { await sock.sendMessage(chatId, { delete: m.key }) } catch {}
        return
      } else if (mutedUntil) mutedUsers.delete(sender)

      const args = text.split(/\s+/)
      const cmd = args[0].toLowerCase()
      const { mentioned, quoted } = getTargets(m)
      const target = mentioned[0] || quoted
      const kingOnly = ['.crown', '.exile']
      const modCommands = ['.vaporise', '.vap', '.d', '.demote', '.p', '.promote', '.paralyse', '.close', '.lock', '.unparalyse', '.open', '.unlock', '.mute', '.unmute']

      if (kingOnly.includes(cmd) && !isKing(sender)) {
        await sock.sendMessage(chatId, { text: 'Only the King can use this command. 👑' }); return
      }
      if (modCommands.includes(cmd) && !(await isGroupAdmin(chatId, sender))) {
        await sock.sendMessage(chatId, { text: 'Only group admins can use moderation commands.' }); return
      }

      if (cmd === '.menu') {
        await sock.sendMessage(chatId, { text: `👑 *BRIGHT KINGDOM MENU* 👑\n\n*KING ONLY:*\n.crown @user [rank]\n.exile @user\n\n*GROUP ADMINS:*\n.vaporise/.vap @user - remove member\n.d/.demote @user\n.p/.promote @user\n.paralyse/.close - restrict chat\n.unparalyse/.open - allow chat\n.mute @user 10m/1h/1d\n.unmute @user\n\n*RANKS:*\n.ranks - show ranks\n.myrank / .rank @user\n\nRanks: queen prince princess duke duchess lord legend jester paladin baron knight slave` })
      } else if (cmd === '.ranks') {
        let out = `👑 *${kingdom.kingdomName.toUpperCase()} RANKS* 👑\n\n`, mentions = []
        for (const rank of Object.values(kingdom.ranks)) {
          out += `${rank.name} (${rank.authority}% authority)\n`
          if (!rank.users.length) out += '  - none\n'
          else rank.users.forEach((u, i) => { out += `${i + 1}. @${u.split('@')[0]}\n`; mentions.push(u) })
          out += '\n'
        }
        await sock.sendMessage(chatId, { text: out, mentions })
      } else if (cmd === '.crown') {
        const rankName = args[2]?.toLowerCase()
        if (!target || !rankName) return sock.sendMessage(chatId, { text: 'Usage: .crown @user queen' })
        if (!kingdom.ranks[rankName] || rankName === 'king') return sock.sendMessage(chatId, { text: 'Invalid rank. The King rank cannot be assigned with this command.' })
        for (const rank of Object.values(kingdom.ranks)) rank.users = rank.users.filter(u => u !== target)
        kingdom.ranks[rankName].users.push(target); save()
        await sock.sendMessage(chatId, { text: `👑 Crowned @${target.split('@')[0]} as ${kingdom.ranks[rankName].name}!`, mentions: [target] })
      } else if (cmd === '.exile') {
        if (!target) return sock.sendMessage(chatId, { text: 'Usage: .exile @user' })
        if (isKing(target)) return sock.sendMessage(chatId, { text: 'The King cannot exile the King account.' })
        for (const rank of Object.values(kingdom.ranks)) rank.users = rank.users.filter(u => u !== target)
        save()
        await sock.sendMessage(chatId, { text: `⚔️ Exiled @${target.split('@')[0]}`, mentions: [target] })
      } else if (cmd === '.myrank') {
        const rank = getRank(sender)
        await sock.sendMessage(chatId, { text: rank ? `You are ${rank.name} (${rank.authority}%)` : 'No rank' })
      } else if (cmd === '.rank') {
        const who = target || sender, rank = getRank(who)
        await sock.sendMessage(chatId, { text: rank ? `@${who.split('@')[0]} is ${rank.name}` : 'No rank', mentions: [who] })
      } else if (['.vaporise', '.vap'].includes(cmd)) {
        if (target) await sock.groupParticipantsUpdate(chatId, [target], 'remove')
      } else if (['.d', '.demote'].includes(cmd)) {
        if (target) await sock.groupParticipantsUpdate(chatId, [target], 'demote')
      } else if (['.p', '.promote'].includes(cmd)) {
        if (target) await sock.groupParticipantsUpdate(chatId, [target], 'promote')
      } else if (['.paralyse', '.close', '.lock'].includes(cmd)) {
        await sock.groupSettingUpdate(chatId, 'announcement')
        await sock.sendMessage(chatId, { text: 'Group restricted 🔒 — only admins can chat.' })
      } else if (['.unparalyse', '.open', '.unlock'].includes(cmd)) {
        await sock.groupSettingUpdate(chatId, 'not_announcement')
        await sock.sendMessage(chatId, { text: 'Group chat reopened 🔓' })
      } else if (cmd === '.mute') {
        if (!target) return sock.sendMessage(chatId, { text: 'Usage: .mute @user 10m (or 1h/1d)' })
        const duration = args[2] || '1h', match = duration.match(/^(\d+)(m|h|d)$/i)
        if (!match || Number(match[1]) < 1) return sock.sendMessage(chatId, { text: 'Use a duration like 10m, 1h, or 1d.' })
        const multiplier = { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()]
        mutedUsers.set(target, Date.now() + Number(match[1]) * multiplier)
        await sock.sendMessage(chatId, { text: `Muted @${target.split('@')[0]} for ${duration} 🤐`, mentions: [target] })
      } else if (cmd === '.unmute') {
        if (!target) return sock.sendMessage(chatId, { text: 'Usage: .unmute @user' })
        mutedUsers.delete(target)
        await sock.sendMessage(chatId, { text: `Unmuted @${target.split('@')[0]} ✅`, mentions: [target] })
      }
    })
  } catch (error) {
    starting = false
    console.error('Bot startup failed:', error.message)
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Bright Kingdom API' }))
app.get('/api/qr', requireDashboardKey, (_req, res) => res.json({ qr: qrData }))
app.get('/api/pair', requireDashboardKey, (_req, res) => res.json({ code: pairCode }))
app.post('/api/pair', requireDashboardKey, async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '')
  if (phone.length < 10 || phone.length > 15) return res.status(400).json({ error: 'Enter phone number with country code, digits only.' })
  if (sock?.user) return res.status(409).json({ error: 'Bot is already connected.' })
  try {
    // The QR socket is already started on boot. Ask that unregistered socket for a
    // pairing code instead of accidentally creating a second WhatsApp connection.
    if (sock && !sock.user) {
      pairCode = await sock.requestPairingCode(phone)
    } else {
      starting = false
      await startBot(phone)
    }
    if (!pairCode) return res.status(503).json({ error: 'Pairing code was not generated. Check backend logs and try again.' })
    return res.json({ code: pairCode })
  } catch (error) { return res.status(500).json({ error: 'Could not start pairing.' }) }
})
app.get('/api/ranks', requireDashboardKey, (_req, res) => res.json(kingdom))
app.get('/api/status', requireDashboardKey, (_req, res) => res.json({ connected: Boolean(sock?.user), king: kingdom.ranks.king.users[0] || null }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Bright Kingdom API listening on ${PORT}`))
startBot()
