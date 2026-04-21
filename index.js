import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definitions (the "menu" we give Claude) ──────────────────
const tools = [
  {
    name: "get_drive_time",
    description: "Gets the current live drive time in minutes between two locations in Israel.",
    input_schema: {
      type: "object",
      properties: {
        origin:      { type: "string", description: "Starting address" },
        destination: { type: "string", description: "Destination address" }
      },
      required: ["origin", "destination"]
    }
  },
  {
    name: "send_telegram",
    description: "Sends a message to Avi's phone via Telegram.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send" }
      },
      required: ["message"]
    }
  }
];

// ── Real tool implementations ─────────────────────────────────────
async function get_drive_time({ origin, destination }) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json`
    + `?origins=${encodeURIComponent(origin)}`
    + `&destinations=${encodeURIComponent(destination)}`
    + `&departure_time=now`
    + `&key=${process.env.GOOGLE_API_KEY}`;

  const response = await fetch(url);
  const data     = await response.json();
  const seconds  = data.rows[0].elements[0].duration_in_traffic.value;
  return { minutes: Math.round(seconds / 60) };
}

async function send_telegram({ message }) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text:    message
    })
  });
  return { sent: true };
}

// ── The agent loop ────────────────────────────────────────────────
async function runAgent() {
  const messages = [
    {
      role: "user",
      content:
        "You are helping Avi, a dance teacher in Israel. " +
        "Every Sunday he drives from HaPnina 2, Ra'anana to Saadia Gaon 24, Tel Aviv. " +
        "He must arrive by 19:00. He likes a 15 minute buffer. " +
        "Check the current drive time, decide when he should leave, " +
        "and send him a friendly message on Telegram. " +
        "If traffic is unusually bad (over 60 min), warn him clearly. " +
        "If traffic is great (under 30 min), let him know he has extra time."
    }
  ];

  // Agent loop — keeps going until Claude is done
  while (true) {
    const response = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages
    });
    
    // Add Claude's response to the conversation
    messages.push({ role: "assistant", content: response.content });

    // If Claude is done — stop the loop
    if (response.stop_reason === "end_turn") {
      console.log("Agent finished.");
      break;
    }

    // If Claude wants to use a tool — run it
    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`Claude is calling: ${block.name}`);

        // Run the actual tool
        let result;
        if (block.name === "get_drive_time") result = await get_drive_time(block.input);
        if (block.name === "send_telegram")  result = await send_telegram(block.input);

        toolResults.push({
          type:        "tool_result",
          tool_use_id: block.id,
          content:     JSON.stringify(result)
        });
      }

      // Send results back to Claude so it can continue thinking
      messages.push({ role: "user", content: toolResults });
    }
  }
}

runAgent();
