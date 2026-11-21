// Helper for demos: creates N extra reservations through the API (one slot per day, rooms 1-5 in turn).
// Usage: node scripts/add-reservations.js 15
const BASE = process.env.API_URL ?? "http://localhost:3000";

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "anna.nowak@example.com", password: "anna-password-123" })
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { accessToken } = await login.json();
  const count = Number(process.argv[2] ?? 10);

  for (let i = 0; i < count; i++) {
    const day = String(1 + i).padStart(2, "0");
    const res = await fetch(`${BASE}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        roomId: (i % 5) + 1,
        participants: 2,
        startTime: `2028-01-${day}T10:00:00Z`,
        endTime: `2028-01-${day}T11:00:00Z`
      })
    });
    if (res.status !== 201) console.log(`#${i + 1}: unexpected status ${res.status}`);
  }
  console.log(`Done - tried to create ${count} reservations.`);
}

main();
