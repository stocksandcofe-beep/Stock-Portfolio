exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const GROQ_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { portfolio, investment, currency } = body;
    if (!portfolio || !portfolio.length) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No portfolio data' }) };
    }

    const assetList = portfolio.map(a =>
        `- ${a.name} (${a.ticker}): ${a.weight}% weight, price ${a.price} ${a.localCurrency}`
    ).join('\n');

    const prompt = `You are a concise, balanced portfolio analyst. A user has built the following investment portfolio:

Total Investment: ${investment} ${currency}

Assets:
${assetList}

Provide a short, honest analysis using bullet points only. Cover:
• Overall diversification quality
• Any concentration risks (single stock, sector, or geographic)
• ETF vs individual stock balance
• Any notable gaps or missing asset classes
• One overall verdict (e.g. Balanced, Concentrated, Growth-heavy, etc.)

Keep it to 6–8 bullet points. Be direct and specific. No preamble, no sign-off.`;

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${GROQ_KEY}`,
            },
            body: JSON.stringify({
                model:       'llama-3.3-70b-versatile',
                messages:    [{ role: 'user', content: prompt }],
                temperature: 0.4,
                max_tokens:  512,
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            return {
                statusCode: res.status,
                body: JSON.stringify({ error: data?.error?.message || 'Groq API error' }),
            };
        }

        const text = data?.choices?.[0]?.message?.content || '';
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: text }),
        };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
