import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { activities, score } = await req.json()
    
    const prompt = `Analyze this user's daily activity data: ${JSON.stringify(activities)}. Their current discipline score is ${score}/100. Write a 2-sentence insightful observation about their day, and provide one specific, actionable tip for tomorrow. Return ONLY a valid JSON object in this exact format, with no markdown formatting or code blocks: {"title": "Short Header", "body": "The 2-sentence insight", "tip": "The tip"}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    const textResponse = data.candidates[0].content.parts[0].text;
    const cleanedJson = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    return new Response(cleanedJson, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})