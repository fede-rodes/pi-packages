import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { QuotaWindow } from "../src/quota.ts";
import { createQuotaStatus } from "../src/status.ts";

const minute = 60_000;
const now = Date.UTC(2026, 10, 24);
const windows: QuotaWindow[] = [
	{ kind: "5h", usedPercent: 62, resetsAtMs: now + 219 * minute },
	{ kind: "weekly", usedPercent: 25, resetsAtMs: now + 8_040 * minute },
];
const footer = "quota 5h 38% left (3h39m) · weekly 75% left (5d14h)";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(t: TestContext) {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now });
	const calls: { signal: AbortSignal; resolve: (value: QuotaWindow[]) => void; reject: (error: Error) => void }[] = [];
	const statuses: (string | undefined)[] = [];
	const status = createQuotaStatus(
		(signal) => new Promise((resolve, reject) => calls.push({ signal, resolve, reject })),
		(text) => statuses.push(text),
	);
	t.after(() => status.stop());
	return { status, calls, statuses, text: () => statuses.at(-1) };
}

test("displays loading immediately, then shows the returned windows", async (t) => {
	const { status, calls, text } = setup(t);
	status.start();
	assert.equal(text(), "quota loading…");
	await flush();
	calls[0].resolve(windows);
	await flush();
	assert.equal(text(), footer);
});

test("times out a hung first request and ignores its late success", async (t) => {
	const { status, calls, text } = setup(t);
	status.start();
	await flush();
	t.mock.timers.tick(9_999);
	assert.equal(text(), "quota loading…");
	t.mock.timers.tick(1);
	await flush();
	assert.equal(text(), "quota unavailable");
	assert.equal(calls[0].signal.aborted, true);
	calls[0].resolve(windows);
	await flush();
	assert.equal(text(), "quota unavailable");
});

test("marks retained values stale after a failed refresh and clears the marker on success", async (t) => {
	const { status, calls, text } = setup(t);
	status.start();
	await flush();
	calls[0].resolve(windows);
	await flush();
	t.mock.timers.tick(minute);
	status.afterTurn();
	await flush();
	calls[1].reject(new Error("private diagnostic"));
	await flush();
	assert.equal(text(), "quota 5h 38% left (3h38m) · weekly 75% left (5d13h) · stale");
	t.mock.timers.tick(minute);
	status.afterTurn();
	await flush();
	calls[2].resolve([{ ...windows[0], usedPercent: 65 }]);
	await flush();
	assert.equal(text(), "quota 5h 35% left (3h37m)");
});

test("coalesces finished turns into a single trailing fetch and only redraws while idle", async (t) => {
	const { status, calls, text } = setup(t);
	status.start();
	await flush();
	status.afterTurn();
	status.afterTurn();
	calls[0].resolve(windows);
	await flush();
	t.mock.timers.tick(minute - 1);
	status.afterTurn();
	await flush();
	assert.equal(calls.length, 1);
	t.mock.timers.tick(1);
	await flush();
	assert.equal(calls.length, 2);
	calls[1].resolve(windows);
	await flush();
	assert.equal(text(), "quota 5h 38% left (3h38m) · weekly 75% left (5d13h)");
	t.mock.timers.tick(minute);
	await flush();
	assert.equal(text(), "quota 5h 38% left (3h37m) · weekly 75% left (5d13h)");
	assert.equal(calls.length, 2);
});

test("stops pending work and prevents late results from redrawing the cleared footer", async (t) => {
	const { status, calls, statuses, text } = setup(t);
	status.start();
	await flush();
	calls[0].resolve(windows);
	await flush();
	status.afterTurn();
	status.stop();
	const cleared = statuses.length;
	t.mock.timers.tick(minute * 2);
	await flush();
	assert.equal(calls.length, 1);
	assert.equal(statuses.length, cleared);
	assert.equal(text(), undefined);

	const active = createQuotaStatus(
		(signal) => new Promise((resolve, reject) => calls.push({ signal, resolve, reject })),
		(value) => statuses.push(value),
	);
	active.start();
	await flush();
	active.stop();
	assert.equal(calls[1].signal.aborted, true);
	calls[1].resolve(windows);
	await flush();
	assert.equal(text(), undefined);
});
