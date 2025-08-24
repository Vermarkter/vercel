// api/chat.js
export default async function handler(req, res) {
  // CORS тільки для твого фронтенду:
  const ORIGIN = 'https://vermarkter.github.io';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

    // Body (fallback для сирого)
    let body = req.body;
    if (!body || typeof body !== 'object') {
      const raw = await new Promise((resolve) => {
        let acc = ''; req.on('data', c => acc += c); req.on('end', () => resolve(acc));
      });
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lang = (body?.lang || 'de').toLowerCase();
    if (messages.length === 0) return res.status(400).json({ error: 'messages must be an array and not empty' });

    const langPhrase = {
      de: 'Antworte streng auf DEUTSCH.',
      en: 'Answer strictly in ENGLISH.',
      uk: 'Відповідай строго УКРАЇНСЬКОЮ.',
      ru: 'Отвечай строго на РУССКОМ.'
    }[lang] || 'Antworte streng auf DEUTSCH.';

    // Промпт: спочатку уточнюючі питання, далі короткий план; терміни і терміни під мову
    const systemContent = `
Ти — маркетолог із 8-річним досвідом у Web, Google Ads, SMM та SEO.
${langPhrase}
Правила: максимум 3 короткі речення; без списків/заголовків; або конкретні запитання, або конкретний план з метриками.
Якщо даних мало — спочатку постав 2–3 уточнення (ніша/бізнес, ціль, бюджет, регіон/мова, тип реклами), і тільки після відповідей давай план.
Якщо запит загальний на кшталт "потрібна реклама/нужна реклама/I need ads/Ich brauche Werbung" — вважай Google Ads та постав ці 2–3 уточнення.
Глосарій термінів за мовою:
- uk: Пошук, КМС (медійна мережа), Ремаркетинг, YouTube, CPA, ROAS.
- ru: Поиск, КМС (контекстно‑медийная сеть), Ремаркетинг, YouTube, CPA, ROAS.
- de: Suche, Display, Remarketing, YouTube, CPA, ROAS.
- en: Search, Display, Remarketing, YouTube, CPA, ROAS.
Коли даних достатньо — дай відповідь до 3 речень з діями і ключовою метрикою (CPA або ROAS).
`.trim();

    // Обрізати надто довге останнє повідомлення
    const last = messages[messages.length - 1];
    if (last && typeof last.content === 'string' && last.content.length > 1200) {
      last.content = last.content.slice(0, 1200) + ' …';
    }

    // Таймаут
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 180,
        messages: [{ role: 'system', content: systemContent }, ...messages]
      }),
      signal: controller.signal
    }).catch(err => {
      if (err.name === 'AbortError') return { ok: false, json: async () => ({ error: 'timeout' }) };
      throw err;
    });
    clearTimeout(timeout);

    const data = await r.json();
    if (!r.ok) {
      if (data?.error === 'timeout') {
        const msg =
          lang === 'uk' ? 'Спробуйте ще раз — сервер відповідав надто довго.' :
          lang === 'ru' ? 'Попробуйте еще раз — сервер отвечал слишком долго.' :
          lang === 'de' ? 'Versuchen Sie es erneut — der Server hat zu lange geantwortet.' :
                          'Try again — the server took too long to respond.';
        return res.status(200).json({ reply: msg });
      }
      return res.status(500).json({ error: 'openai_error', detail: data });
    }

    // Санітизація: без маркдауна/списків, до 3 речень
    function sanitize(txt) {
      if (!txt) return '';
      return txt
        .replace(/[#*_`>]+/g, ' ')
        .replace(/^\s*([\-\*•]|\d+[\.\)]|\(\d+\))\s*/gm, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\n+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s+/)
        .slice(0, 3)
        .join(' ')
        .trim();
    }

    const replyRaw = data?.choices?.[0]?.message?.content || '';
    const reply = sanitize(replyRaw) || (
      lang === 'uk' ? 'Опишіть, будь ласка, задачу: Web / Google Ads / SMM / SEO.' :
      lang === 'ru' ? 'Опишите, пожалуйста, задачу: Web / Google Ads / SMM / SEO.' :
      lang === 'de' ? 'Beschreiben Sie bitte kurz die Aufgabe: Web / Google Ads / SMM / SEO.' :
                      'Please describe your task: Web / Google Ads / SMM / SEO.'
    );

    return res.status(200).json({ reply });
  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
