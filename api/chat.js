// api/chat.js — мінімальний робочий варіант для Vercel
module.exports = async (req, res) => {
  // CORS (для швидкої перевірки)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

    // безпечно парсимо тіло
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = await new Promise((resolve) => {
        let acc = '';
        req.on('data', (c) => (acc += c));
        req.on('end', () => resolve(acc));
      });
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages) return res.status(400).json({ error: 'messages must be an array' });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'openai_error', detail: data });

    const reply = data?.choices?.[0]?.message?.content || 'No reply';
    res.status(200).json({ reply });
  } catch (e) {
    console.error('Server error', e);
    res.status(500).json({ error: 'Server error' });
  }
};
