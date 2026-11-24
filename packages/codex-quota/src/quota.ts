const usageUrl = "https://chatgpt.com/backend-api/wham/usage";

export type QuotaWindow = { kind: "5h" | "weekly"; usedPercent: number; resetsAtMs: number };

function record(value: unknown): Record<string, unknown> | undefined {
	if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
}

export function parseQuota(body: unknown): QuotaWindow[] {
	const limit = record(record(body)?.rate_limit);
	const windows = new Map<QuotaWindow["kind"], QuotaWindow>();
	for (const field of ["primary_window", "secondary_window"] as const) {
		const row = record(limit?.[field]);
		if (!row) continue;
		const { limit_window_seconds: duration, used_percent: usedPercent, reset_at: resetAt } = row;
		const kind = duration === 18_000 ? "5h" : duration === 604_800 ? "weekly" : undefined;
		if (!kind || windows.has(kind)) continue;
		if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) continue;
		if (typeof resetAt !== "number" || !Number.isSafeInteger(resetAt) || resetAt <= 0) continue;
		const resetsAtMs = resetAt * 1_000;
		if (Number.isSafeInteger(resetsAtMs)) windows.set(kind, { kind, usedPercent, resetsAtMs });
	}
	return [windows.get("5h"), windows.get("weekly")].filter((window) => window !== undefined);
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
	getAccessToken: () => Promise<string | undefined>,
	signal: AbortSignal,
	request: typeof fetch = fetch,
): Promise<QuotaWindow[]> {
	try {
		signal.throwIfAborted();
		const token = await getAccessToken();
		signal.throwIfAborted();
		const parts = token?.split(".") ?? [];
		if (!token || parts.length !== 3) throw new Error();
		// This claim is only used to route the request; ChatGPT validates the token.
		const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		const accountId = record(record(payload)?.["https://api.openai.com/auth"])?.chatgpt_account_id;
		if (typeof accountId !== "string" || !accountId.trim()) throw new Error();

		const response = await request(usageUrl, {
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
