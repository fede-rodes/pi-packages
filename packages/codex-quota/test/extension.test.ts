import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import register from "../src/index.ts";

const codex = { provider: "openai-codex", id: "codex" };
const other = { provider: "openai", id: "other" };
const token = `header.${Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "fake-account" },
})).toString("base64url")}.signature`;
const now = Date.UTC(2026, 10, 24);
const sample = () => Response.json({
	rate_limit: { primary_window: { limit_window_seconds: 18_000, used_percent: 62, reset_at: now / 1_000 + 13_140 } },
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(t: TestContext, request: typeof fetch = async () => sample()) {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now });
	const network = t.mock.method(globalThis, "fetch", request);
	const status = new Map<string, string>();
	const authCalls: string[] = [];
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const api = { on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler) };
	register(api as unknown as Parameters<typeof register>[0]);
	const emit = (name: string, event: object = {}, model = codex, mode = "tui") => handlers.get(name)!({ type: name, ...event }, {
		model,
		mode,
		ui: {
			theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
			setStatus: (key: string, value?: string) => value === undefined ? status.delete(key) : status.set(key, value),
		},
		modelRegistry: { getApiKeyForProvider: async (provider: string) => {
			authCalls.push(provider);
			return token;
		} },
	});
	t.after(() => { emit("session_shutdown"); });
	return { emit, status: () => status.get("codex-quota"), authCalls, network };
}

test("non-TUI and non-Codex startup do not show a status or resolve credentials", async (t) => {
	const { emit, status, authCalls, network } = fixture(t);
	emit("session_start", {}, codex, "rpc");
	emit("model_select", { model: codex }, codex, "rpc");
	emit("session_start", {}, codex, "print");
	emit("session_start", {}, other);
	await flush();
	assert.equal(status(), undefined);
	assert.deepEqual(authCalls, []);
	assert.equal(network.mock.callCount(), 0);
});

test("Codex startup loads non-blockingly with Pi auth and uses the footer's dim theme color", async (t) => {
	const { emit, status, authCalls } = fixture(t);
	assert.equal(emit("session_start"), undefined);
	assert.equal(status(), "<dim>quota loading…</dim>");
	await flush();
	assert.deepEqual(authCalls, ["openai-codex"]);
	assert.equal(status(), "<dim>quota 5h 38% left (3h39m)</dim>");
	emit("session_shutdown");
	assert.equal(status(), undefined);
});

test("provider changes start and stop quota checks; Codex model changes keep the active check", async (t) => {
	const requests: { signal: AbortSignal | null | undefined; resolve: (response: Response) => void }[] = [];
	const { emit, status, network } = fixture(t, (_url, init) => new Promise((resolve) => {
		requests.push({ signal: init?.signal, resolve });
	}));
	emit("session_start", {}, other);
	emit("model_select", { model: codex, previousModel: other }, codex);
	assert.equal(status(), "<dim>quota loading…</dim>");
	await flush();
	emit("model_select", { model: { ...codex, id: "another-codex" }, previousModel: codex });
	await flush();
	assert.equal(network.mock.callCount(), 1);
	emit("model_select", { model: other, previousModel: codex }, other);
	assert.equal(status(), undefined);
	assert.equal(requests[0].signal?.aborted, true);
	emit("model_select", { model: codex, previousModel: other }, codex);
	await flush();
	requests[0].resolve(sample());
	await flush();
	assert.equal(status(), "<dim>quota loading…</dim>");
	assert.equal(network.mock.callCount(), 2);
	requests[1].resolve(sample());
	await flush();
	assert.equal(status(), "<dim>quota 5h 38% left (3h39m)</dim>");
});

test("only completed Codex assistant turns trigger a quota recheck", async (t) => {
	const { emit, network } = fixture(t);
	emit("session_start");
	await flush();
	t.mock.timers.tick(60_000);
	emit("turn_end", { outcome: "aborted", message: { role: "assistant", provider: codex.provider } });
	emit("turn_end", { outcome: "completed", message: { role: "assistant", provider: other.provider } });
	emit("turn_end", { outcome: "completed", message: { role: "user" } });
	await flush();
	assert.equal(network.mock.callCount(), 1);
	emit("turn_end", { outcome: "completed", message: { role: "assistant", provider: codex.provider } });
	await flush();
	assert.equal(network.mock.callCount(), 2);
});
