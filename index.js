async function getDriveTime() {
  const origin      = "HaPnina 2, Raanana, Israel";
  const destination = "Saadia Gaon 24, Tel Aviv, Israel";
  const apiKey      = process.env.GOOGLE_API_KEY;

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&departure_time=now&key=${apiKey}`;

  const response = await fetch(url);
  const data     = await response.json();

  const seconds = data.rows[0].elements[0].duration_in_traffic.value;
  return Math.round(seconds / 60);
}

function calculateLeaveTime(driveMinutes) {
  const buffer          = 15;
  const totalMinutes    = driveMinutes + buffer;
  const arriveInMinutes = 19 * 60;
  const leaveInMinutes  = arriveInMinutes - totalMinutes;
  const leaveHour       = Math.floor(leaveInMinutes / 60);
  const leaveMinute     = leaveInMinutes % 60;

  return `${leaveHour}:${String(leaveMinute).padStart(2, '0')}`;
}

async function sendMessage(text) {
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url    = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text })
  });
}

async function sundayAgent() {
  const driveMinutes = await getDriveTime();
  const leaveTime    = calculateLeaveTime(driveMinutes);

  await sendMessage(
    `Avi, leave work by ${leaveTime}!\n` +
    `Drive time right now: ${driveMinutes} min + 15 min buffer.\n` +
    `Destination: Saadia Gaon 24, Tel Aviv. Enjoy the dancing! 💃`
  );

  console.log(`Done! Message sent. Leave by ${leaveTime}`);
}

sundayAgent();
