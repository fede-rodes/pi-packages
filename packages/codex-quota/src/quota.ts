import type { CodexAuth } from "./auth.ts";

/**
 * Fetches usage and identifies the 5-hour and weekly windows. Formats the
 * remaining percentages and reset countdowns.
 */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const FIVE_HOUR_WINDOW_SECONDS = 18_000;
const WEEKLY_WINDOW_SECONDS = 604_800;

export type QuotaWindow = { kind: "5h" | "weekly"; usedPercent: number; resetsAtMs: number };

function record(value: unknown): Record<string, unknown> | undefined {
	if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
}

function parseWindow(value: unknown): QuotaWindow | undefined {
	const row = record(value);
	if (!row) return;

	const { limit_window_seconds: duration, used_percent: usedPercent, reset_at: resetAt } = row;
	const kind = duration === FIVE_HOUR_WINDOW_SECONDS ? "5h" : duration === WEEKLY_WINDOW_SECONDS ? "weekly" : undefined;
	if (!kind) return;
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return;
	if (typeof resetAt !== "number" || !Number.isSafeInteger(resetAt) || resetAt <= 0) return;

	const resetsAtMs = resetAt * 1_000;
	if (Number.isSafeInteger(resetsAtMs)) return { kind, usedPercent, resetsAtMs };
}

export function parseQuota(body: unknown): QuotaWindow[] {
	const limit = record(record(body)?.rate_limit);
	const windows = [parseWindow(limit?.primary_window), parseWindow(limit?.secondary_window)];
	return [windows.find((window) => window?.kind === "5h"), windows.find((window) => window?.kind === "weekly")]
		.filter((window) => window !== undefined);
}

function countdown(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	const hours = Math.floor(minutes / 60);
	if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`;
	if (hours > 0) return `${hours}h${minutes % 60}m`;
	return `${minutes}m`;
}

export function formatQuota(windows: readonly QuotaWindow[], nowMs: number): string {
	const parts = windows.map(({ kind, usedPercent, resetsAtMs }) =>
		`${kind} ${Math.round(100 - usedPercent)}% left (${countdown(resetsAtMs - nowMs)})`,
	);
	return `quota ${parts.join(" · ")}`;
}

export async function fetchQuota(
	{ token, accountId }: CodexAuth,
	signal: AbortSignal,
	request: typeof fetch = fetch,
): Promise<QuotaWindow[]> {
	try {
		signal.throwIfAborted();

		const response = await request(USAGE_URL, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": accountId },
			redirect: "error",
			signal,
		});
		if (!response.ok) throw new Error();
		const windows = parseQuota(await response.json());
		if (windows.length === 0) throw new Error();
		return windows;
	} catch {
		throw new Error("Codex quota unavailable");
	}
}
