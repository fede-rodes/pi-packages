import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchQuota, formatQuota, parseQuota } from "../src/quota.ts";

const now = Date.UTC(2026, 10, 24);
const fiveHour = { limit_window_seconds: 18_000, used_percent: 62, reset_at: now / 1_000 + 13_140 };
const weekly = { limit_window_seconds: 604_800, used_percent: 25, reset_at: now / 1_000 + 482_400 };
const usage = { rate_limit: { primary_window: weekly, secondary_window: fiveHour } };
const auth = { token: "fake-token", accountId: "fake-account" };

test("formats percent remaining and reset countdowns in duration order", () => {
	assert.equal(formatQuota(parseQuota(usage), now), "quota 5h 38% left (3h39m) · weekly 75% left (5d14h)");
});

test("shows only recognized, valid windows regardless of response field", () => {
	assert.equal(formatQuota(parseQuota({ rate_limit: { primary_window: weekly } }), now), "quota weekly 75% left (5d14h)");
	for (const row of [null, {}, { ...fiveHour, limit_window_seconds: 1 }, { ...fiveHour, used_percent: -1 },
		{ ...fiveHour, used_percent: 101 }, { ...fiveHour, used_percent: "62" }, { ...fiveHour, reset_at: 0 }]) {
		assert.deepEqual(parseQuota({ rate_limit: { primary_window: row } }), []);
	}
});

test("shows zero remaining for an exhausted window and clamps elapsed resets", () => {
	const exhausted = { ...fiveHour, used_percent: 100, reset_at: now / 1_000 - 1 };
	assert.equal(formatQuota(parseQuota({ rate_limit: { primary_window: exhausted } }), now), "quota 5h 0% left (0m)");
});

test("sends bearer auth to the fixed origin without following redirects", async () => {
	const signal = new AbortController().signal;
	let calls = 0;
	const windows = await fetchQuota(auth, signal, async (url, init) => {
		calls++;
		assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
		assert.equal(init?.method, "GET");
		assert.equal(init?.redirect, "error");
		assert.equal(init?.signal, signal);
		assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${auth.token}`);
		assert.equal(new Headers(init?.headers).get("chatgpt-account-id"), "fake-account");
		return Response.json(usage);
	});
	assert.equal(calls, 1);
	assert.equal(windows.length, 2);
});

test("does not fetch after cancellation", async () => {
	let calls = 0;
	await assert.rejects(fetchQuota(auth, AbortSignal.abort(), async () => {
		calls++;
		return Response.json(usage);
	}));
	assert.equal(calls, 0);
});

test("does not expose service bodies or runtime errors", async () => {
	const signal = new AbortController().signal;
	for (const request of [
		async () => new Response(auth.token, { status: 401 }),
		async () => Response.json({ message: auth.token }),
		async () => new Response(auth.token),
		async () => { throw new Error(auth.token); },
	]) {
		await assert.rejects(fetchQuota(auth, signal, request), { message: "Codex quota unavailable" });
	}
});
