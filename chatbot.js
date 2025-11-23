import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { tavily } from '@tavily/core';
import NodeCache from 'node-cache';
import { type } from 'os';

//tool calling => Used to interact with externam sources such as APIs, DB and web

dotenv.config();

const tvly = tavily({ apiKey: process.env.TAVILY_WEB_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// cache memory till 24 hours using node official in memory cache system
const myCache = new NodeCache({stdTTL: 60 * 60 * 24})
// safe JSON parse helper
function safeJSONParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

export async function generate(userMessage, threadId) {
  const baseMessages = [
    {
      role: 'system',
      // Minimal change: instruct model to request searches using NEED_SEARCH:
      content: `You are Hanuman, a smart personal assistant. Be always polite.
If you need current/real-time info, reply exactly with: NEED_SEARCH: <search query>
Otherwise answer normally.
current date and time: ${new Date().toUTCString()}`,
    },
    // {
    //   role: 'user',
    //   content: 'When was iphone 16 launched?'
    // }
  ];

  const messages = myCache.get(threadId) ?? baseMessages

    messages.push({
      role: 'user',
      content: userMessage,
    })

    while (true) {
      const completions = await groq.chat.completions.create({
        temperature: 0,
        model: 'llama-3.3-70b-versatile',
        messages: messages
        // <-- Minimal change: removed `tools` and `tool_choice` because Groq rejects function execution
      });
  
      // push the assistant message into messages (preserve your flow)
      messages.push(completions.choices[0].message);
  
      // if assistant answered directly (no NEED_SEARCH), break
      const assistantContent = completions.choices[0].message.content || '';
      if (!assistantContent.startsWith('NEED_SEARCH:')) {
        console.log(`Assistant1: ${assistantContent}`);
        myCache.set(threadId, messages)
        console.log("myCache1",JSON.stringify(myCache.data))
        return completions.choices[0].message.content 
      }
  
      // assistant asked for a search: extract query
      const rawQuery = assistantContent.replace('NEED_SEARCH:', '').trim();
      if (!rawQuery) {
        console.error('No query found after NEED_SEARCH:');
        break;
      }
  
      // call Tavily (your original function)
      const toolResult = await webSearchByTavily({ query: rawQuery });
  
      // Minimal fix: ensure tool_call_id exists (Groq requires it for role: 'tool')
      // Use a fallback id if tool.id is not present in the tool calls (we're simulating)
      const fallbackToolCallId = `webSearch_${Date.now()}`;
  
      messages.push({
        role: 'tool',
        tool_call_id: fallbackToolCallId,
        name: 'webSearch',
        content: JSON.stringify(toolResult),
      });
  
      // Now ask Groq again (finalize answer) — keep this small and consistent with your flow
      const completions2 = await groq.chat.completions.create({
        temperature: 0,
        model: 'llama-3.3-70b-versatile',
        messages: messages
      });
  
      console.log('Assistant2:', completions2.choices[0].message.content);
      //here we end the chatbot response
      myCache.set(threadId, messages)
      return completions2.choices[0].message.content;
    }

}

//=== TAVILY web api call ==
async function webSearchByTavily({ query }) {
  console.log('Calling web search... ', query);

  const response = await tvly.search(query);
  // default is 5 results - map to content as you already did
  const finalResult = response.results.map(result => result.content);
  return finalResult;
}
