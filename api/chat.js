// api/chat.js — Vercel Edge Function (ESM)
export const config = { runtime: 'edge' };

const ALLOW_ORIGIN = 'https://vermarkter.github.io'; // фронтенд-домен

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ALLOW_ORIGIN,
      'access-control-allow-methods': 'POST, OPTIONS, GET',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '86400',
      'vary': 'origin'
    }
  });
}

function sanitize(txt) {
  if (!txt) return '';
  txt = txt.replace(/[#*_`>]+/g, ' ')
           .replace(/^[\s\-•\d.)]+/gm, '')
           .replace(/\s{2,}/g, ' ')
           .replace(/\n+/g, ' ')
           .trim();
  const sentences = txt.split(/(?<=[.!?])\s+/).slice(0, 3);
  let out = sentences.join(' ').trim();
  if (!out.toLowerCase().includes('@marketing_in_deutschland')) out += cta;
  return out;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': ALLOW_ORIGIN,
      'access-control-allow-methods': 'POST, OPTIONS, GET',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '86400',
      'vary': 'origin'
    }
  });

  if (req.method === 'GET') {
    return json({ status: 'ok', hint: 'Use POST with {messages:[...], lang:"de|en|uk|ru"}' });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: 'OPENAI_API_KEY missing' }, 500);

    let body; try { body = await req.json(); } catch { body = {}; }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lang = (body?.lang || 'de').toLowerCase();
    if (messages.length === 0) return json({ error: 'messages must be a non-empty array' }, 400);

    const langPhrase = {
      de: 'Antworte auf DEUTSCH.',
      en: 'Answer in ENGLISH.',
      uk: 'Відповідай УКРАЇНСЬКОЮ.',
      ru: 'Отвечай на РУССКОМ.'
    }[lang] || 'Antworte auf DEUTSCH.';

    const systemContent =
      'Ти — маркетолог із 8-річним досвідом. Відповідай практично, дієво і дуже коротко — максимум у 3 речення. ' +
      'Без Markdown, без списків, без нумерацій, без заголовків: лише звичайний текст. ' +
      'Для Google Ads — стисла структура + 1–2 гіпотези + ключова метрика; для SMM — стисла ідея контент‑плану + воронка; ' +
      'для SEO — 2–3 пріоритети. 
      'За запитом вкажи мінімальні ціни: створення сайту від 50€, запуск SMM від 50€, запуск Google Ads від 50€. ' +
      langPhrase;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [{ role: 'system', content: systemContent }, ...messages]
      })
    });

    const data = await r.json();
    if (!r.ok) return json({ error: 'openai_error', detail: data }, 500);

    const replyRaw = data?.choices?.[0]?.message?.content || '';
    const reply = sanitize(replyRaw) || 'Напишіть у Telegram @Marketing_in_Deutschland — надішлю план/кошторис.';
    return json({ reply });
  } catch (e) {
    return json({ error: 'Server error' }, 500);
  }
}
