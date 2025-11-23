import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { tavily } from '@tavily/core';
import NodeCache from 'node-cache';

dotenv.config();

const tvly = tavily({ apiKey: process.env.TAVILY_WEB_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// cache conversation memory per thread for 24 hours
const myCache = new NodeCache({ stdTTL: 60 * 60 * 24 });

// How many times we allow the model to request NEED_SEARCH in one generate() call
const MAX_TOOL_LOOPS = 3;

// Helper: call Tavily
async function webSearchByTavily(query) {
  console.log('Calling Tavily web search with query:', query);

  const response = await tvly.search({
    query,
    // you can tune these:
    // max_results: 5,
    // search_depth: 'basic',
  });

  // map to just the content text to keep token size lower
  const finalResult = response.results.map((result) => result.content);
  return finalResult;
}

/**
 * Chat generate function
 * @param {string} userMessage - message from frontend
 * @param {string} threadId - unique id for conversation (e.g. userId or sessionId)
 * @returns {Promise<string>} - final assistant reply (no NEED_SEARCH ever)
 */
export async function generate(userMessage, threadId) {
  try {
    // Base system + previous memory
    const baseMessages = [
      {
        role: 'system',
        content: `
You are Hanuman, a helpful, polite personal assistant.

- You can answer general knowledge questions directly.
- If the user asks for current/real-time information (e.g. weather, live scores, stock prices, latest news),
  then you MUST respond with exactly:
  NEED_SEARCH: <best search query>
  and nothing else.

- After you receive search results from a tool (role: "tool", name: "webSearch"),
  you must use ONLY that information plus your knowledge to give a clear, friendly answer.
- Never mention NEED_SEARCH or tools to the user in your final reply.

Current date and time: ${new Date().toUTCString()}
        `.trim(),
      },
    ];

    // Restore previous conversation or start new
    const cachedMessages = myCache.get(threadId);
    const messages = cachedMessages ? [...cachedMessages] : [...baseMessages];

    // Add the user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    // Loop allows: LLM → NEED_SEARCH → Tavily → LLM (final)
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        messages,
      });

      const assistantMessage = completion.choices[0]?.message || {};
      const assistantContent = assistantMessage.content || '';

      // Save assistant message into conversation history
      messages.push({
        role: 'assistant',
        content: assistantContent,
      });

      // If the model did NOT request a search → final answer
      if (!assistantContent.startsWith('NEED_SEARCH:')) {
        console.log('Assistant (final):', assistantContent);
        myCache.set(threadId, messages);
        return assistantContent;
      }

      // === NEED_SEARCH path ===
      const rawQuery = assistantContent.replace('NEED_SEARCH:', '').trim();
      if (!rawQuery) {
        console.error('NEED_SEARCH used but no query provided by model.');
        const fallbackResponse =
          "Sorry, I couldn't understand what to search for. Please rephrase your question.";
        messages.push({
          role: 'assistant',
          content: fallbackResponse,
        });
        myCache.set(threadId, messages);
        return fallbackResponse;
      }

      console.log('Model requested search for:', rawQuery);

      // Call Tavily
      let toolResult;
      try {
        toolResult = await webSearchByTavily(rawQuery);
      } catch (err) {
        console.error('Tavily search error:', err);
        const errorResponse =
          "I'm having trouble fetching live info right now. Please try again later.";
        messages.push({
          role: 'assistant',
          content: errorResponse,
        });
        myCache.set(threadId, messages);
        return errorResponse;
      }

      // Push tool result as a "tool" message into history
      messages.push({
        role: 'tool',
        name: 'webSearch',
        tool_call_id: `webSearch_${Date.now()}`, // synthetic id (Groq doesn't really use it)
        content: JSON.stringify(toolResult),
      });

      // Ask Groq again to generate final answer using tool result
      const completion2 = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        messages,
      });

      const finalAssistantMessage = completion2.choices[0]?.message || {};
      const finalContent = finalAssistantMessage.content || '';

      console.log('Assistant (after tool):', finalContent);

      messages.push({
        role: 'assistant',
        content: finalContent,
      });

      // End here – this is the final response user sees
      myCache.set(threadId, messages);
      return finalContent;
    }

    // Safety fallback if MAX_TOOL_LOOPS exceeded
    const loopError =
      'Sorry, something went wrong while processing your request. Please try again.';
    myCache.set(threadId, messages);
    return loopError;
  } catch (err) {
    console.error('Fatal error in generate():', err);
    return 'Sorry, I ran into an error while answering. Please try again in a moment.';
  }
}
