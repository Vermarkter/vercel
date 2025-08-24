// api/chat.js
module.exports = async (req, res) => {
  // --- CORS (додано більше заголовків) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "false");
  
  // Обов'язково відповідати на OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    // --- читання JSON body (виправлено) ---
    let body = req.body;
    
    // Якщо body порожній або не об'єкт, читаємо raw data
    if (!body || typeof body !== "object") {
      const raw = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => {
          data += chunk;
        });
        req.on("end", () => {
          resolve(data);
        });
        req.on("error", (err) => {
          reject(err);
        });
      });
      
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        return res.status(400).json({ error: "Invalid JSON" });
      }
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lang = (body?.lang || "de").toLowerCase();
    
    if (messages.length === 0) {
      return res.status(400).json({ error: "messages must be an array and not empty" });
    }

    // --- мовні налаштування ---
    const langPhrase = {
      de: "Antworte streng auf DEUTSCH.",
      en: "Answer strictly in ENGLISH.",
      uk: "Відповідай строго УКРАЇНСЬКОЮ.",
      ru: "Отвечай строго на РУССКОМ."
    }[lang] || "Antworte streng auf DEUTSCH.";

    // --- системний промпт ---
    const systemContent = `
Ти — маркетолог із 8-річним досвідом у Web, Google Ads, SMM та SEO.
Відповідай строго мовою користувача. ${langPhrase}
Правила: максимум 3 короткі речення; жодних списків, заголовків і води; тільки конкретні дії та метрики.
Відповідай лише на те, що запитав користувач. Не пропонуй писати в Telegram, якщо прямо не просять ціну чи контакт.
Якщо запит загальний "потрібна реклама", вважай це Google Ads і дай конкретний план.
Формат для намірів:
- Web: тип сайту (лендинг/магазин/корпоративний) + ключовий блок конверсії + орієнтовний термін.
- Google Ads: тип кампанії (Пошук/Shopping/Performance Max/Ремаркетинг/YouTube) + 1 гіпотеза + ключова метрика (CPA або ROAS).
- SMM: ідея контент‑плану + проста воронка (охоплення → взаємодія → ліди).
- SEO: 2–3 пріоритети (техніка/семантика/контент/посилання) + очікуваний горизонт результатів.
Коли запитують про бюджет/ціни — коротко: створення сайту від 50€, запуск SMM від 50€, запуск Google Ads від 50€, SEO від 50€.
Приклади:
Користувач: "потрібна реклама" → Відповідь: "Google Ads: старт з Пошуку за намірами 'купити/ціна', тести 2 оголошень на групу й 1 сторінка з формою заявки; метрика — CPA. Далі PMax для масштабування товарів. Орієнтир перших заявок — 3–7 днів."
Користувач: "потрібен сайт" → Відповідь: "Лендинг на 1–2 екрани з чітким оффером, формою заявки та трекінгом GA4/конверсій. Термін — ~7 днів. Готовий стартовий контент і 1–2 UGC‑відгуки підвищать конверсію."
${langPhrase}
`.trim();

    // --- обмеження довжини останнього повідомлення ---
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && typeof lastMessage.content === "string" && lastMessage.content.length > 1200) {
      lastMessage.content = lastMessage.content.slice(0, 1200) + " …";
    }

    // --- контролер таймауту ---
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 12000); // 12 секунд

    try {
      // --- запит до OpenAI ---
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 200,
          messages: [
            { role: "system", content: systemContent },
            ...messages
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      
      if (!response.ok) {
        console.error("OpenAI API error:", data);
        return res.status(500).json({ 
          error: "openai_error", 
          detail: data 
        });
      }

      // --- очищення відповіді ---
      function sanitize(txt) {
        if (!txt) return "";
        return txt
          .replace(/[#*_`>]+/g, " ")                         // markdown символи
          .replace(/^\s*([\-\*•]|\d+[\.\)]|\(\d+\))\s*/gm, "") // списки та нумерація
          .replace(/\s{2,}/g, " ")                          // подвійні пробіли
          .replace(/\n+/g, " ")                             // переноси рядків
          .trim()
          .split(/(?<=[.!?])\s+/)                           // розділення на речення
          .slice(0, 3)                                      // максимум 3 речення
          .join(" ")
          .trim();
      }

      const replyRaw = data?.choices?.[0]?.message?.content || "";
      const reply = sanitize(replyRaw) || getDefaultMessage(lang);

      return res.status(200).json({ reply });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === "AbortError") {
        const timeoutMsg = getTimeoutMessage(lang);
        return res.status(200).json({ reply: timeoutMsg });
      }
      
      console.error("Fetch error:", fetchError);
      return res.status(500).json({ 
        error: "fetch_error", 
        detail: fetchError.message 
      });
    }

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ 
      error: "server_error",
      detail: error.message 
    });
  }
};

// --- допоміжні функції ---
function getTimeoutMessage(lang) {
  switch (lang) {
    case "uk": return "Спробуйте ще раз — сервер відповідав надто довго.";
    case "ru": return "Попробуйте еще раз — сервер отвечал слишком долго.";
    case "de": return "Versuchen Sie es erneut — der Server hat zu lange geantwortet.";
    default: return "Try again — the server took too long to respond.";
  }
}

function getDefaultMessage(lang) {
  switch (lang) {
    case "uk": return "Опишіть, будь ласка, задачу: Web / Google Ads / SMM / SEO.";
    case "ru": return "Опишите, пожалуйста, задачу: Web / Google Ads / SMM / SEO.";
    case "de": return "Beschreiben Sie bitte kurz die Aufgabe: Web / Google Ads / SMM / SEO.";
    default: return "Please describe your task: Web / Google Ads / SMM / SEO.";
  }
}
