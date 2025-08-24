// api/chat.js
module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY missing" });

    // --- read JSON body (fallback for raw) ---
    let body = req.body;
    if (!body || typeof body !== "object") {
      const raw = await new Promise((resolve) => {
        let acc = ""; req.on("data", c => acc += c); req.on("end", () => resolve(acc));
      });
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lang = (body?.lang || "de").toLowerCase();
    if (messages.length === 0) {
      return res.status(400).json({ error: "messages must be an array and not empty" });
    }

    // --- enforce output language explicitly ---
    const langPhrase = {
      de: "Antworte streng auf DEUTSCH.",
      en: "Answer strictly in ENGLISH.",
      uk: "Відповідай строго УКРАЇНСЬКОЮ.",
      ru: "Отвечай строго на РУССКОМ."
    }[lang] || "Antworte streng auf DEUTSCH.";

    // --- system prompt: no greetings, no lists, <=3 sentences ---
    const systemContent = `
Ти — маркетолог із 8-річним досвідом. Завжди відповідай лише на конкретний запит користувача.
❗ Формат відповіді: максимум 3 короткі речення. 
❗ Заборонено: списки, заголовки, пояснення, загальна теорія.
Для Web: вкажи тип сайту (лендинг, магазин чи корпоративний) і термін виконання.
Для Google Ads: вкажи тип кампанії (пошукова, медійна, ремаркетинг чи YouTube), 1 гіпотезу і ключову метрику.
Для SMM: коротка ідея контент-плану і воронка продажів.
Для SEO: 2–3 пріоритети оптимізації.
Якщо запит не стосується Web, Ads, SMM чи SEO — запропонуй написати в Telegram @Marketing_in_Deutschland.
Відповідай мовою запиту: uk / ru / de / en.
${langPhrase}
`;

    // --- trim overly long user message ---
    const last = messages[messages.length - 1];
    if (last && typeof last.content === "string" && last.content.length > 1200) {
      last.content = last.content.slice(0, 1200) + " …";
    }

    // --- timeout controller ---
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s

    // --- OpenAI call with token limit ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 220,
        messages: [{ role: "system", content: systemContent }, ...messages]
      }),
      signal: controller.signal
    }).catch(err => {
      if (err.name === "AbortError") {
        return { ok: false, json: async () => ({ error: "timeout" }) };
      }
      throw err;
    });
    clearTimeout(timeout);

    const data = await r.json();
    if (!r.ok) {
      if (data?.error === "timeout") {
        const msg =
          (lang === "uk") ? "Спробуйте ще раз — сервер відповідав надто довго." :
          (lang === "ru") ? "Попробуйте еще раз — сервер отвечал слишком долго." :
          (lang === "de") ? "Versuchen Sie es erneut — der Server hat zu lange geantwortet." :
                            "Try again — the server took too long to respond.";
        return res.status(200).json({ reply: msg });
      }
      return res.status(500).json({ error: "openai_error", detail: data });
    }

    // --- sanitize: remove lists/markdown/newlines; keep <=3 sentences ---
    function sanitize(txt) {
      if (!txt) return "";
      return txt
        .replace(/[#*_`>]+/g, " ")                         // markdown chars
        .replace(/^\s*([\-\*•]|\d+[\.\)]|\(\d+\))\s*/gm, "") // bullets & numbering at line start
        .replace(/\s{2,}/g, " ")
        .replace(/\n+/g, " ")
        .trim()
        .split(/(?<=[.!?])\s+/)
        .slice(0, 3)
        .join(" ")
        .trim();
    }

    const replyRaw = data?.choices?.[0]?.message?.content || "";
    const reply = sanitize(replyRaw) || (
      lang === "uk" ? "Опишіть, будь ласка, задачу: Web / Google Ads / SMM / SEO." :
      lang === "ru" ? "Опишите, пожалуйста, задачу: Web / Google Ads / SMM / SEO." :
      lang === "de" ? "Beschreiben Sie bitte kurz die Aufgabe: Web / Google Ads / SMM / SEO." :
                      "Please describe your task: Web / Google Ads / SMM / SEO."
    );

    return res.status(200).json({ reply });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
};
