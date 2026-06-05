import fetch from "node-fetch";

async function run() {
  const res = await fetch("http://localhost:3000/api/generate-syllabus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: "React Context",
      mode: "hunt",
      difficulty: "beginner",
      framework: "React"
    })
  });
  const data = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", data);
}
run();
