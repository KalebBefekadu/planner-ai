import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Simple in-memory rate limiter for MVP (Issue #19)
const rateLimitMap = new Map<string, { count: number, timestamp: number }>();
const RATE_LIMIT = 20; // max requests per minute
const RATE_LIMIT_WINDOW = 60000;

export async function POST(request: Request) {
  // Apply naive rate limiting
  const ip = request.headers.get('x-forwarded-for') || 'anonymous';
  const now = Date.now();
  const rateData = rateLimitMap.get(ip) || { count: 0, timestamp: now };
  
  if (now - rateData.timestamp > RATE_LIMIT_WINDOW) {
    rateData.count = 1;
    rateData.timestamp = now;
  } else {
    rateData.count++;
  }
  rateLimitMap.set(ip, rateData);

  if (rateData.count > RATE_LIMIT) {
    return NextResponse.json({ error: "Rate limit exceeded. Please try again later." }, { status: 429 });
  }

  try {
    const { goalText, type } = await request.json();
    
    if (!goalText || goalText.trim().length < 3) {
      return NextResponse.json({ isSmart: false, suggestion: null, warning: "Goal is too short." });
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: `You are an expert goal-setting coach. The user wants to set a ${type} goal. Evaluate if the goal is SMART (Specific, Measurable, Achievable, Relevant, Time-bound). Return a JSON object with strictly these keys:
          - "isSmart" (boolean): true if it's already a perfect SMART goal, false otherwise.
          - "warning" (string or null): If false, a 1-sentence explanation of why it's too vague.
          - "suggestion" (string or null): If false, a rewritten version of their goal that makes it SMART.` 
        },
        { 
          role: 'user', 
          content: goalText 
        }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    return NextResponse.json({
      isSmart: parsed.isSmart || false,
      warning: parsed.warning || null,
      suggestion: parsed.suggestion || null
    });

  } catch (error: any) {
    console.error("SMART Goal error:", error);
    return NextResponse.json({ error: "Failed to analyze goal" }, { status: 500 });
  }
}
