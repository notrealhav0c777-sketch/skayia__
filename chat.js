// SKAY.IA - servidor (Vercel Serverless). As chaves ficam nas variáveis de ambiente, nunca no navegador.
const hits = {};
const SYS = 'Você é a SKAY.IA. Responda em português do Brasil, de forma correta, segura e útil. Se não tiver certeza de algo, diga claramente.';
const gpt = async (ms, sys) => {
  const k = process.env.OPENAI_API_KEY; if (!k) throw new Error('sem chave OpenAI');
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o', messages: [{ role: 'system', content: sys }, ...ms] }) });
  const j = await r.json(); if (!r.ok) throw new Error('OpenAI ' + r.status); return j.choices[0].message.content;
};
const cla = async (ms, sys) => {
  const k = process.env.ANTHROPIC_API_KEY; if (!k) throw new Error('sem chave Anthropic');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, system: sys, messages: ms }) });
  const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status); return j.content.map(c => c.text || '').join('');
};
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const code = process.env.ACCESS_CODE;
  if (code && req.headers['x-code'] !== code) return res.status(401).json({ error: 'Código de acesso inválido', needCode: true });
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0], now = Date.now();
  hits[ip] = (hits[ip] || []).filter(t => now - t < 36e5);
  if (hits[ip].length >= (+process.env.HOURLY_LIMIT || 30)) return res.status(429).json({ error: 'Limite por hora atingido. Tente mais tarde.' });
  hits[ip].push(now);
  let ms = (req.body && req.body.messages) || [];
  ms = Array.isArray(ms) ? ms.slice(-10).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 4000) })) : [];
  if (!ms.length || ms[ms.length - 1].role !== 'user') return res.status(400).json({ error: 'Mensagem inválida' });
  const q = ms[ms.length - 1].content;
  const [g, c] = await Promise.allSettled([gpt(ms, SYS), cla(ms, SYS)]);
  if (g.status !== 'fulfilled' && c.status !== 'fulfilled') return res.status(502).json({ error: 'As duas fontes falharam: ' + g.reason.message + ' | ' + c.reason.message });
  if (g.status !== 'fulfilled' || c.status !== 'fulfilled') {
    const ok = g.status === 'fulfilled' ? g : c;
    return res.status(200).json({ answer: ok.value, mode: 'single', drafts: null });
  }
  const sp = 'Você é a mente única da SKAY.IA. Duas fontes (ChatGPT e Claude) escreveram rascunhos para o mesmo pedido. Verifique os dois com rigor, descarte erros e invenções, una o melhor de cada um e escreva UMA resposta final, em português do Brasil, como SKAY.IA, sem citar as fontes nem o processo. Se as fontes se contradisserem em um fato importante e você não puder resolver, diga que há incerteza.';
  const body = [{ role: 'user', content: 'Pedido do usuário:\n' + q + '\n\n[Rascunho ChatGPT]\n' + g.value + '\n\n[Rascunho Claude]\n' + c.value }];
  let answer; try { answer = await cla(body, sp); } catch (e) { try { answer = await gpt(body, sp); } catch (e2) { answer = c.value; } }
  res.status(200).json({ answer, mode: 'unified', drafts: { chatgpt: g.value, claude: c.value } });
};
