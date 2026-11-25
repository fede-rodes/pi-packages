/** Resolves Pi's Codex token and reads the account ID from its JWT payload. */
export type CodexAuth = { token: string; accountId: string };

export async function resolveCodexAuth(
	getAccessToken: () => Promise<string | undefined>,
	signal: AbortSignal,
): Promise<CodexAuth> {
	try {
		signal.throwIfAborted();
		const token = await getAccessToken();
		signal.throwIfAborted();
		const parts = token?.split(".") ?? [];
		if (!token || parts.length !== 3) throw new Error();

		// The claim only routes the request; ChatGPT validates the token.
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
			"https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
		} | null;
		const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
		if (typeof accountId !== "string" || !accountId.trim()) throw new Error();
		return { token, accountId };
	} catch {
		throw new Error("Codex quota unavailable");
	}
}
