import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { tavily } from '@tavily/core';
import NodeCache from 'node-cache';

dotenv.config();

const tvly = tavily({ apiKey: process.env.TAVILY_WEB_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// cache 24 hours
const myCache = new NodeCache({ stdTTL: 86400 });

// Tavily search helper
async function webSearch(query) {
  console.log("🔎 Calling Tavily:", query);
  const resp = await tvly.search(query);
  return resp.results.map(r => r.content);
}

export async function generate(userMessage, threadId) {

  const baseMessages = [
    {
      role: "system",
      content: `
You are Hanuman, a helpful and polite AI assistant.

Rules:
- If user asks for real-time, uncertain or external information
  respond ONLY with: NEED_SEARCH: <best query>
  and nothing else.
- NEVER ask the user to type NEED_SEARCH.
- After receiving tool results, summarize clearly.
- Never mention NEED_SEARCH or tools to the user.
Current UTC: ${new Date().toUTCString()}
`.trim(),
    }
  ];

  const messages = myCache.get(threadId) ?? [...baseMessages];

  messages.push({
    role: "user",
    content: userMessage,
  });

  while (true) {
    const resp = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      messages,
    });

    const assistantMsg = resp.choices[0].message;
    const content = assistantMsg.content || "";

    messages.push({ role: "assistant", content });

    // 👉 If no search requested
    if (!content.startsWith("NEED_SEARCH:")) {
      myCache.set(threadId, messages);
      return content;
    }

    // Extract search query
    const query = content.replace("NEED_SEARCH:", "").trim();
    console.log("🤖 Model requested search:", query);

    // Call Tavily
    const results = await webSearch(query);

    // Provide results back to LLM
    messages.push({
      role: "tool",
      name: "webSearch",
      content: JSON.stringify(results),
    });

    // Ask LLM for final answer
    const resp2 = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      messages,
    });

    const finalMsg = resp2.choices[0].message.content;
    messages.push({ role: "assistant", content: finalMsg });

    myCache.set(threadId, messages);
    return finalMsg;
  }
}
