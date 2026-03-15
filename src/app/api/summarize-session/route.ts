import { LlmAgent, Gemini, InMemoryRunner } from '@google/adk';
import { SESSION_EVALUATOR_INSTRUCTION, buildEvaluationTranscriptPrompt } from '@/config/prompts';

export async function POST(req: Request) {
  try {
    const { transcript } = await req.json();

    if (!transcript) {
      return Response.json({ error: "No transcript provided" }, { status: 400 });
    }

    // Define a specialized Post-Session Evaluation Agent using ADK
    const evaluatorAgent = new LlmAgent({
      name: 'SessionEvaluator',
      model: new Gemini({ model: 'gemini-2.5-flash' }),
      instruction: SESSION_EVALUATOR_INSTRUCTION,
      // Force structured JSON output
      outputSchema: {
         type: "object",
         properties: {
            bugsDetected: { 
              type: "array", 
              items: { type: "string" },
              description: "List of bugs the developer successfully identified."
            },
            improvedAreas: { 
              type: "array", 
              items: { type: "string" },
              description: "Areas for improvement or things the developer missed."
            }
         },
         required: ["bugsDetected", "improvedAreas"]
      } as any
    });

    const runner = new InMemoryRunner({ 
      agent: evaluatorAgent, 
      appName: 'SpotTheBug' 
    });
    
    // We can run the agent and capture the final state/events
    const results = [];
    for await (const event of runner.runEphemeral({ 
      userId: 'user', 
      newMessage: { role: 'user', parts: [{ text: buildEvaluationTranscriptPrompt(transcript) }] }
    })) {
       results.push(event);
    }
    
    // Extract the final text response from the agent
    const modelResponse = results.reverse().find((e: any) => e.type === "agent_response" || e.type === "content_event" || e?.modelTurn);
    
    // Provide the structured JSON back. The standard response should be parsed text if it followed JSON schema
    let structuredResponse = {};
    try {
      if (modelResponse && 'content' in modelResponse) {
        // extract the text from ContentEvent or thought
        // This is a rough estimation, the actual type might have text inside
        // console.log(JSON.stringify(modelResponse));
      }
    } catch(e) {}
    
    // As a fallback for prototyping, we can also extract state from the session
    return Response.json({ results: results });
  } catch (error: any) {
    console.error("Error summarizing session:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

