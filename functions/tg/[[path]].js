// Телеграм-бот «ГульРейтинг» целиком на Cloudflare Pages Functions:
// отдельный сервер или Workers-проект не нужны.
//
// Эндпоинты:
//   GET  /tg/setup  — одноразово регистрирует вебхук у Телеграма
//                     (нужен env TG_BOT_TOKEN);
//   POST /tg/webhook — апдейты Телеграма: команды /start /help /top /random;
//   POST /tg/notify  — уведомление в чат компании о новой оценке; вызывается
//                     сайтом после сохранения оценки и проверяется живой
//                     Supabase-сессией (Bearer access_token), поэтому
//                     посторонний спамер в чат не напишет.
//
// Переменные окружения Pages (Settings → Environment variables):
//   TG_BOT_TOKEN      — токен бота из @BotFather;
//   TG_CHAT_ID        — id чата компании (куда падают уведомления);
//   SUPABASE_URL      — URL проекта Supabase;
//   SUPABASE_ANON_KEY — anon-ключ Supabase.
// Без них эндпоинты отвечают вежливой инструкцией, сайт работает как раньше.

const TG_API = 'https://api.telegram.org';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function text(msg, status = 200) {
  return new Response(msg, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function envMissing(env) {
  const missing = ['TG_BOT_TOKEN', 'TG_CHAT_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']
    .filter((k) => !env[k]);
  return missing.length ? missing : null;
}

async function tgCall(env, method, payload) {
  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json().catch(() => ({ ok: false }));
}

async function sendMessage(env, chatId, msg) {
  return tgCall(env, 'sendMessage', { chat_id: chatId, text: msg });
}

// Все оценки компании одним запросом (база маленькая, страниц нет)
async function fetchRatings(env) {
  const url = `${env.SUPABASE_URL}/rest/v1/ratings?select=user_id,rating,titles(title,release_date,media_type)`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
    }
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Средние оценки по тайтлам: [{ title, year, type, avg, count }]
function aggregate(ratings) {
  const map = new Map();
  for (const r of ratings || []) {
    const t = r.titles;
    if (!t) continue;
    const cur = map.get(String(t.id)) || { title: t.title, year: (t.release_date || '').slice(0, 4), type: t.media_type, sum: 0, count: 0 };
    cur.sum += Number(r.rating);
    cur.count += 1;
    map.set(String(t.id), cur);
  }
  return [...map.values()]
    .map((c) => ({ ...c, avg: Math.round((c.sum / c.count) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count);
}

const HELP_TEXT = [
  'ГульРейтинг-бот, команды:',
  '/top — топ-5 тайтлов по средним оценкам компании',
  '/random — случайный тайтл из оценённых компанией',
  '/help — эта справка',
  '',
  'Уведомления о новых оценках друзей приходят в этот чат автоматически.'
].join('\n');

async function handleWebhook(env, update) {
  const message = update && update.message;
  if (!message || !message.text) return json({ ok: true });
  const chatId = message.chat && message.chat.id;
  const cmd = message.text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];

  if (cmd === '/start' || cmd === '/help') {
    if (String(chatId) !== String(env.TG_CHAT_ID)) {
      await sendMessage(env, chatId, 'Этот бот обслуживает только чат компании ГульРейтинг.');
      return json({ ok: true });
    }
    await sendMessage(env, chatId, cmd === '/start'
      ? 'Чат подключён к ГульРейтингу: уведомления о новых оценках будут приходить сюда.\n' + HELP_TEXT
      : HELP_TEXT);
    return json({ ok: true });
  }

  if (String(chatId) !== String(env.TG_CHAT_ID)) return json({ ok: true });

  if (cmd === '/top') {
    const ratings = await fetchRatings(env);
    if (!ratings) {
      await sendMessage(env, chatId, 'Не удалось прочитать базу оценок.');
      return json({ ok: true });
    }
    const top = aggregate(ratings).slice(0, 5);
    await sendMessage(env, chatId, top.length
      ? 'Топ компании:\n' + top.map((t, i) => `${i + 1}. ${t.title}${t.year ? ' (' + t.year + ')' : ''} — ${t.avg.toFixed(1)} (${t.count})`).join('\n')
      : 'В базе пока нет оценок.');
    return json({ ok: true });
  }

  if (cmd === '/random') {
    const ratings = await fetchRatings(env);
    const list = aggregate(ratings);
    if (!list.length) {
      await sendMessage(env, chatId, 'В базе пока нет оценок.');
      return json({ ok: true });
    }
    const pick = list[Math.floor(Math.random() * list.length)];
    await sendMessage(env, chatId, `Смотрите сегодня: ${pick.title}${pick.year ? ' (' + pick.year + ')' : ''} — средняя оценка компании ${pick.avg.toFixed(1)}.`);
    return json({ ok: true });
  }

  return json({ ok: true });
}

// Уведомление о новой оценке: проверяем, что запрос пришёл от живой
// сессии Supabase, и берём имя из профиля — посторонние написать не могут
async function handleNotify(env, request, body) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, error: 'no session' }, 401);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY }
  });
  if (!userRes.ok) return json({ ok: false, error: 'bad session' }, 401);
  const user = await userRes.json().catch(() => null);
  if (!user || !user.id) return json({ ok: false, error: 'bad session' }, 401);

  let username = 'Кто-то из компании';
  const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=username`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` }
  });
  if (profileRes.ok) {
    const rows = await profileRes.json().catch(() => []);
    if (rows && rows[0] && rows[0].username) username = rows[0].username;
  }

  const title = String((body && body.title) || '').slice(0, 120) || 'тайтл';
  const rating = Number(body && body.rating);
  const type = body && body.media_type === 'tv' ? 'tv' : 'movie';
  const id = Number(body && body.title_id);
  const origin = new URL(request.url).origin;
  const link = Number.isFinite(id) && id > 0 ? `${origin}/?title=${type}:${id}` : origin;

  await sendMessage(env, env.TG_CHAT_ID,
    `🎬 ${username} оценил(а) «${title}» на ${Number.isFinite(rating) ? rating.toFixed(1) : '?'}/10\n${link}`);
  return json({ ok: true });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  if (url.pathname === '/tg/setup') {
    const missing = envMissing(env);
    if (missing) return text(`Не заполнены переменные окружения: ${missing.join(', ')}`);
    const webhookUrl = `${url.origin}/tg/webhook`;
    const res = await tgCall(env, 'setWebhook', { url: webhookUrl });
    return text(res && res.ok
      ? `Вебхук установлен: ${webhookUrl}`
      : `Телеграм отклонил вебхук: ${JSON.stringify(res)}`);
  }

  return text('ГульРейтинг-бот: эндпоинты /tg/setup, /tg/webhook, /tg/notify.');
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const missing = envMissing(env);
  if (missing) return json({ ok: false, error: `missing env: ${missing.join(', ')}` }, 503);

  const body = await request.json().catch(() => null);

  if (url.pathname === '/tg/webhook') return handleWebhook(env, body);
  if (url.pathname === '/tg/notify') return handleNotify(env, request, body);
  return json({ ok: false, error: 'not found' }, 404);
}
