const test = require("node:test");
const assert = require("node:assert/strict");
const updates = require("../update-check");

test("version order is numeric, including a leading v", () => {
  assert.deepEqual(updates.parseVersion("v1.3.0"), [1, 3, 0]);
  assert.equal(updates.compareVersions("1.2.2", "1.3.0"), -1);
  assert.equal(updates.compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(updates.compareVersions("v1.3.0", "1.3.0"), 0);
  assert.equal(updates.compareVersions("nope", "1.3.0"), null);
});

test("a newer GitHub release offers its release page and short notes", () => {
  const result = updates.resultFromRelease("1.3.0", {
    tag_name: "v1.4.0",
    html_url: "https://github.com/dsarangi7/Pomodoro-Float/releases/tag/v1.4.0",
    body: "## Pomodoro Float 1.4.0\n\n- Daily tasks stay on the card\n- History calendar",
  });
  assert.equal(result.state, "update");
  assert.equal(result.message, "v1.4.0 is available.");
  assert.match(result.notes, /Daily tasks stay on the card/);
  assert.equal(result.url, "https://github.com/dsarangi7/Pomodoro-Float/releases/tag/v1.4.0");
});

test("the same version is current and a foreign url is not opened", () => {
  const result = updates.resultFromRelease("1.3.0", {
    tag_name: "v1.3.0",
    html_url: "https://example.com/releases/v1.3.0",
    body: "same",
  });
  assert.equal(result.state, "current");
  assert.equal(result.message, "You're up to date.");
  assert.equal(result.url, "");
  assert.equal(updates.isReleasePage("https://github.com/dsarangi7/Pomodoro-Float/releases/latest"), true);
  assert.equal(updates.isReleasePage("https://github.com/other/Pomodoro-Float/releases/latest"), false);
  assert.equal(updates.isReleasePage("http://github.com/dsarangi7/Pomodoro-Float/releases/latest"), false);
});

test("rate limits and failed responses stay distinct from a newer release", () => {
  assert.equal(updates.classifyHttp(429, "0", ""), "rate-limited");
  assert.equal(updates.classifyHttp(403, "0", "API rate limit exceeded"), "rate-limited");
  assert.equal(updates.classifyHttp(403, "40", "Resource not accessible"), "error");
  assert.equal(updates.classifyHttp(500, "", ""), "error");
  assert.equal(updates.statusResult("offline", "1.3.0").message, "Couldn't reach GitHub. Try again.");
  assert.match(updates.statusResult("rate-limited", "1.3.0").message, /limiting update checks/);
  assert.equal(updates.LATEST_API, "https://api.github.com/repos/dsarangi7/Pomodoro-Float/releases/latest");
});
