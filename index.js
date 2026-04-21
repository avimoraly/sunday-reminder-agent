import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Load memory ───────────────────────────────────────────────────
const memory = JSON.parse(fs.readFileSync("memory.json", "utf8"));
const historyText = memory.history.length === 0
  ? "No history yet — this is the first run."
  : memory.history.map(h =>
      `${h.date}: drive was ${h.drive_minutes} min, ` +
      `left at ${h.left_at}, ` +
      `buffer was ${h.buffer_was_enough ? "enough" : "NOT enough"}`
    ).join("\n");

// ── Tools ─────────────────────────────────────────────────────────
const tools = [
  {
    name: "get_drive_time",
    description: "Gets the current live drive time in minutes between two locations in Israel.",
    input_schema: {
      type: "object",
      properties: {
        origin:      { type: "string" },
        destination: { type: "string" }
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
        message: { type: "string" }
      },
      required: ["message"]
    }
  },
  {
    name: "save_to_memory",
    description: "Saves this run's data to memory for future reference.",
    input_schema: {
      type: "object",
      properties: {
        drive_minutes:    { type: "number",  description: "How long the drive took today" },
        left_at:          { type: "string",  description: "What time Avi should leave e.g. 18:24" },
        buffer_was_enough:{ type: "boolean", description: "Was the 15 min buffer enough?" }
      },
      required: ["drive_minutes", "left_at", "buffer_was_enough"]
    }
  }
];

// ── Tool implementations ──────────────────────────────────────────
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

function save_to_memory({ drive_minutes, left_at, buffer_was_enough }) {
  const today = new Date().toISOString().split("T")[0];
  memory.history.push({ date: today, drive_minutes, left_at, buffer_was_enough });

  // Keep only last 10 weeks
  if (memory.history.length > 10) memory.history.shift();

  fs.writeFileSync("memory.json", JSON.stringify(memory, null, 2));
  console.log("Memory saved!");
  return { saved: true };
}

// ── Agent loop ────────────────────────────────────────────────────
async function runAgent() {
  const messages = [
    {
      role: "user",
      content:
        "You are helping Avi, a dance teacher in Israel. " +
        "Every Sunday he drives from HaPnina 2, Ra'anana to Saadia Gaon 24, Tel Aviv. " +
        "He must arrive by 19:00. He likes a 15 minute buffer. " +
        "\n\nHere is the history of recent Sundays:\n" + historyText +
        "\n\nYour job today: " +
        "1. Check the current drive time. " +
        "2. Look at the history — has the buffer been enough? Adjust your advice if needed. " +
        "3. Send Avi a friendly Telegram message with your recommendation. " +
        "4. Save this run to memory."
    }
  ];

  while (true) {
    const response = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages
    });

    console.log("Claude says:", JSON.stringify(response.content, null, 2));
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      console.log("Agent finished.");
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`Claude is calling: ${block.name}`);

        let result;
        if (block.name === "get_drive_time")  result = await get_drive_time(block.input);
        if (block.name === "send_telegram")   result = await send_telegram(block.input);
        if (block.name === "save_to_memory")  result = save_to_memory(block.input);

        toolResults.push({
          type:        "tool_result",
          tool_use_id: block.id,
          content:     JSON.stringify(result)
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}

runAgent();
