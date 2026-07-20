import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function POST(request: Request) {
  try {
    const { visionText } = await request.json();
    
    if (!visionText || visionText.trim().length < 20) {
      return NextResponse.json({ questions: [] });
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: 'You are a life coach. Read the user\'s vision and ask 2 deep, provocative Socratic questions to help them refine it. Return ONLY a JSON object with a single property "questions" that contains an array of 2 strings. Output valid JSON.' 
        },
        { 
          role: 'user', 
          content: visionText 
        }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content || '{"questions": []}';
    const parsed = JSON.parse(content);

    return NextResponse.json({ questions: parsed.questions || [] });

  } catch (error: any) {
    console.error("Socratic generation error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate questions" }, { status: 500 });
  }
}
