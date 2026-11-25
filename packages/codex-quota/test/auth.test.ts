import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCodexAuth } from "../src/auth.ts";

const payload = Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "fake-account" },
})).toString("base64url");
const token = `header.${payload}.signature`;

test("resolves the access token and its Codex account ID", async () => {
	const { signal } = new AbortController();
	assert.deepEqual(await resolveCodexAuth(async () => token, signal), { token, accountId: "fake-account" });
});

test("rejects missing or invalid credentials without exposing lookup errors", async () => {
	const { signal } = new AbortController();
	for (const getToken of [
		async () => undefined,
		async () => "header.e30.signature",
		async () => "header.bm90LWpzb24.signature",
		async () => { throw new Error(token); },
	]) {
		await assert.rejects(resolveCodexAuth(getToken, signal), { message: "Codex quota unavailable" });
	}
});

test("checks cancellation before and after token lookup", async () => {
	const controller = new AbortController();
	await assert.rejects(resolveCodexAuth(async () => {
		controller.abort();
		return token;
	}, controller.signal));
	let lookedUp = false;
	await assert.rejects(resolveCodexAuth(async () => {
		lookedUp = true;
		return token;
	}, controller.signal));
	assert.equal(lookedUp, false);
});
