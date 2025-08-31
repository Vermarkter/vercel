// api/chat.js
export default async function handler(req, res) {
  const allowlist = [
    'https://vermarkter.github.io',
    'https://vercel-sable-ten.vercel.app',
    'http://localhost:5500',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  if (allowlist.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

    let body = req.body;
    if (!body || typeof body !== 'object') {
      const raw = await new Promise((resolve) => {
        let acc = ''; req.on('data', c => acc += c); req.on('end', () => resolve(acc));
      });
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    // Обмежуємо історію до останніх 6 повідомлень
    const messages = Array.isArray(body.messages)
      ? body.messages.slice(-6)
      : [];
    
    if (messages.length === 0) return res.status(400).json({ error: 'messages must be an array and not empty' });

    const validLangs = ['uk', 'ru', 'de', 'en'];
    const lang = validLangs.includes(body.lang?.toLowerCase())
      ? body.lang.toLowerCase()
      : 'de';

    const langPhrase = {
      de: 'Antworte streng auf DEUTSCH.',
      en: 'Answer strictly in ENGLISH.',
      uk: 'Відповідай строго УКРАЇНСЬКОЮ.',
      ru: 'Отвечай строго на РУССКОМ.'
    }[lang];

    const systemContent = `
Ти — маркетолог із 8-річним досвідом у Web, Google Ads, SMM та SEO.
${langPhrase}

Головне правило: максимум 3 короткі речення; без списків/заголовків; або став 2–3 уточнюючі запитання, або давай конкретний план з діями та метрикою.

Перевір, чи користувач надав:
1) нішу/бізнес,
2) географію,
3) ціль (ліди/продажі/впізнаваність/повторні),
4) бюджет,
5) канал (Google Ads / SMM / SEO / сайт).

Якщо чогось бракує — НЕ давай план, а постав 2–3 короткі уточнення (напр.: "який бюджет?", "яка ціль?", "яке місто?", "який канал?").
Коли все зрозуміло — дай план до 3 речень з конкретними діями і однією ключовою метрикою (CPA або ROAS).

Якщо запит загальний ("потрібна реклама" / "нужна реклама" / "I need ads" / "Ich brauche Werbung") — вважай це Google Ads і постав 2–3 уточнення (ніша, бюджет, регіон/місто, тип: Пошук/КМС/Remarketing/YouTube).

Глосарій (відповідай термінами мовою користувача):
- uk: Пошук, КМС, Ремаркетинг, YouTube, CPA, ROAS.
- ru: Поиск, КМС, Ремаркетинг, YouTube, CPA, ROAS.
- de: Suche, Display, Remarketing, YouTube, CPA, ROAS.
- en: Search, Display, Remarketing, YouTube, CPA, ROAS.
`.trim();

    const last = messages[messages.length - 1];
    if (last && typeof last.content === 'string' && last.content.length > 1200) {
      last.content = last.content.slice(0, 1200) + ' …';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
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

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.error === 'timeout') {
        const msg =
          lang === 'uk' ? 'Спробуйте ще раз — сервер відповідав надто довго.' :
          lang === 'ru' ? 'Попробуйте еще раз — сервер отвечал слишком долго.' :
          lang === 'de' ? 'Versuchen Sie es erneut — der Server hat zu lange geantwortet.' :
                         'Try again — the server took too long to respond.';
        return res.status(200).json({ reply: msg });
      }
      return res.status(500).json({ error: 'openai_error', detail: data });
    }

    const data = await response.json();
    const replyRaw = data?.choices?.[0]?.message?.content || '';
    
    function sanitize(text) {
      if (!text) return '';
      return text
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

    const reply = sanitize(replyRaw) || (
      lang === 'uk' ? 'Опишіть, будь ласка, задачу: Web / Google Ads / SMM / SEO.' :
      lang === 'ru' ? 'Опишите, пожалуйста, задачу: Web / Google Ads / SMM / SEO.' :
      lang === 'de' ? 'Beschreiben Sie bitte kurz die Aufgabe: Web / Google Ads / SMM / SEO.' :
                     'Please describe your task: Web / Google Ads / SMM / SEO.'
    );

    res.status(200).json({ reply });
  } catch (e) {
    console.error('Server error:', e);
    res.status(500).json({ error: 'Server error' });
  }
}
