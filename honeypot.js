import { appendFile } from 'node:fs/promises';
import { Client as HoneypotClient, Events as HpEvents } from 'fluxer-selfbot';
import { Client as BotClient, Events } from '@fluxerjs/core';

const MESSAGE_LOG = new URL('./messages.log', import.meta.url);

const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const cfg = {
  honeypotToken: process.env.HONEYPOT_TOKEN,
  botToken: process.env.MOD_BOT_TOKEN,
  guildIds: list(process.env.GUILD_IDS),
  logChannelId: process.env.LOG_CHANNEL_ID,
  mode: process.env.MODE === 'ban' ? 'ban' : 'log',
  allow: new Set(list(process.env.ALLOW_IDS)),
  joinWindowMs: Number(process.env.JOIN_WINDOW_MIN ?? 30) * 60_000,
  contactWindowMs: Number(process.env.CONTACT_WINDOW_MIN ?? 10) * 60_000,
  incomingRequestType: Number(process.env.INCOMING_REQUEST_TYPE ?? 3),
};

for (const key of ['honeypotToken', 'botToken', 'logChannelId']) {
  if (!cfg[key]) throw new Error(`missing config: ${key}`);
}
if (!cfg.guildIds.length) throw new Error('missing config: GUILD_IDS');

const LINK = /(https?:\/\/\S+|www\.\S+|\S+\.gg\/\S+|\/invite\/\S+)/gi;

const hp = new HoneypotClient();
const bot = new BotClient();

const recentJoins = new Map();
const contacts = new Map();
const handled = new Set();
const inFlight = new Set();

const joinedRecently = (userId) => {
  const at = recentJoins.get(userId);
  return at !== undefined && Date.now() - at < cfg.joinWindowMs;
};

const recordContact = (userId, trigger) => {
  const now = Date.now();
  const seen = contacts.get(userId) ?? new Map();
  for (const [kind, at] of seen) if (now - at > cfg.contactWindowMs) seen.delete(kind);
  const repeat = seen.has(trigger);
  seen.set(trigger, now);
  contacts.set(userId, seen);
  return { repeat, others: [...seen.keys()].filter((kind) => kind !== trigger) };
};

const hostsOf = (text) =>
  (text.match(LINK) ?? []).map((raw) => {
    try {
      return new URL(raw.startsWith('http') ? raw : `https://${raw}`).host;
    } catch {
      return raw.slice(0, 40);
    }
  });

const mentionsHoneypot = (message) => {
  const me = hp.user?.id;
  if (!me) return false;
  if (message.mentions?.some?.((u) => u?.id === me)) return true;
  const content = message.content ?? '';
  return content.includes(`<@${me}>`) || content.includes(`<@!${me}>`);
};

const attachmentsOf = (message) =>
  [...(message.attachments?.values?.() ?? [])].map((a) => a?.url ?? a?.filename).filter(Boolean);

const saveMessage = async (message, kind) => {
  const author = message.author;
  const where = message.guildId ? ` guild ${message.guildId} / channel ${message.channelId}` : '';
  const files = attachmentsOf(message);
  const line = [
    new Date().toISOString(),
    `${kind}${where}`,
    `${author?.username ?? '?'} (${author?.id ?? '?'})`,
    JSON.stringify(message.content ?? ''),
    files.length ? `attachments: ${files.join(' ')}` : '',
  ].filter(Boolean).join('  ');
  try {
    await appendFile(MESSAGE_LOG, `${line}\n`);
  } catch (err) {
    console.error('message log write failed:', err);
  }
};

const quote = (text, files = []) => {
  const body = [text?.trim() ?? '', ...files].filter(Boolean).join('\n');
  if (!body) return '';
  const cut = body.length > 1000 ? `${body.slice(0, 1000)}…` : body;
  return `\n${cut.split('\n').map((l) => `> ${l}`).join('\n')}`;
};

const log = async (line) => {
  console.log(line);
  try {
    await bot.channels.send(cfg.logChannelId, { content: line, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('log channel send failed:', err);
  }
};

const banEverywhere = async (userId, reason) => {
  const results = [];
  for (const guildId of cfg.guildIds) {
    try {
      const guild = await bot.guilds.resolve(guildId);
      await guild.ban(userId, { reason, deleteMessageDays: 1 });
      results.push({ guildId, ok: true });
    } catch (err) {
      results.push({ guildId, ok: false, error: err?.message ?? String(err) });
    }
  }
  return results;
};

const judge = async ({ user, trigger, text, files = [], pinged = false, where }) => {
  if (!user?.id || user.id === hp.user?.id || user.bot || cfg.allow.has(user.id)) return;
  const said = quote(text, files);

  const hosts = text ? hostsOf(text) : [];
  const { repeat, others: alsoDid } = recordContact(user.id, trigger);
  const reasons = [];
  if (pinged) reasons.push('@ mentioned the honeypot inside the DM');
  if (joinedRecently(user.id)) reasons.push(`joined < ${cfg.joinWindowMs / 60_000}m ago`);
  const extras = hosts.length ? [`link: ${hosts.join(', ')}`] : [];

  const who = `${user.username ?? '?'} (${user.id})${where ? ` in ${where}` : ''}`;
  const convict = trigger === 'dm' && reasons.length > 0;

  const status = handled.has(user.id) ? ` - already ${cfg.mode === 'ban' ? 'banned' : 'flagged'}` : '';

  if (!convict) {
    if (repeat) {
      if (said) await log(`[honeypot] ${trigger} from ${who}${status}${extras.length ? ` (${extras.join('; ')})` : ''}${said}`);
      return;
    }
    const notes = [...reasons, ...extras];
    if (alsoDid.length) notes.push(`also ${alsoDid.join(' + ')} within ${cfg.contactWindowMs / 60_000}m`);
    await log(`[honeypot] ${trigger} from ${who} - noted, no action${notes.length ? ` (${notes.join('; ')})` : ''}${said}`);
    return;
  }
  if (handled.has(user.id) || inFlight.has(user.id)) {
    if (said) await log(`[honeypot] ${trigger} from ${who}${status}${said}`);
    return;
  }

  const reason = `honeypot ${trigger}: ${[...reasons, ...extras].join('; ')}`;
  if (cfg.mode !== 'ban') {
    handled.add(user.id);
    await log(`[honeypot] WOULD BAN ${who} — ${reason}${said}`);
    return;
  }

  inFlight.add(user.id);
  try {
    const results = await banEverywhere(user.id, reason);
    const anyBanned = results.some((r) => r.ok);
    if (anyBanned) handled.add(user.id);
    const lines = results.map((r) => `${r.guildId}: ${r.ok ? 'banned' : `failed (${r.error})`}`);
    await log(`[honeypot] ${anyBanned ? 'BANNED' : 'BAN FAILED, will retry on next DM'} ${who} — ${reason}${said}\n${lines.join('\n')}`);
  } finally {
    inFlight.delete(user.id);
  }
};

hp.on(HpEvents.Ready, () => console.log(`honeypot online as ${hp.user?.username}`));

hp.on(HpEvents.MessageCreate, (message) => {
  if (message.author?.id === hp.user?.id) return;
  const text = message.content ?? '';
  const files = attachmentsOf(message);
  if (!message.guildId) {
    saveMessage(message, 'dm');
    judge({ user: message.author, trigger: 'dm', text, files, pinged: mentionsHoneypot(message) }).catch(console.error);
    return;
  }
  if (!mentionsHoneypot(message)) return;
  saveMessage(message, 'ping');
  judge({
    user: message.author,
    trigger: 'ping',
    text,
    files,
    where: `guild ${message.guildId} / channel ${message.channelId}`,
  }).catch(console.error);
});

bot.on(Events.Ready, () => console.log(`mod bot online as ${bot.user?.username}`));

bot.on(Events.GuildMemberAdd, (member) => {
  if (!cfg.guildIds.includes(member.guildId ?? member.guild?.id)) return;
  const id = member.user?.id ?? member.id;
  if (id) recentJoins.set(id, Date.now());
});

setInterval(() => {
  const cutoff = Date.now() - cfg.joinWindowMs;
  for (const [id, at] of recentJoins) if (at < cutoff) recentJoins.delete(id);
  const contactCutoff = Date.now() - cfg.contactWindowMs;
  for (const [id, seen] of contacts) {
    if ([...seen.values()].every((at) => at < contactCutoff)) contacts.delete(id);
  }
}, 60_000).unref();

await bot.login(cfg.botToken);
await hp.login(cfg.honeypotToken);

hp.ws.on('dispatch', ({ payload }) => {
  if (payload?.t !== 'RELATIONSHIP_ADD') return;
  if (cfg.mode === 'log') console.log('RELATIONSHIP_ADD raw:', JSON.stringify(payload.d));
  if (payload.d?.type !== cfg.incomingRequestType) return;
  judge({ user: payload.d.user, trigger: 'friend request', text: '' }).catch(console.error);
});
console.log(`mode: ${cfg.mode}`);
