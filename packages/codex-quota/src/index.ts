import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexAuth } from "./auth.ts";
import { fetchQuota } from "./quota.ts";
import { createQuotaStatus } from "./status.ts";

/**
 * Connects the quota status to Pi's session, model, and turn events.
 * Shows it only for Codex and uses the same dim theme color as Pi's footer.
 */

const CODEX_PROVIDER = "openai-codex";
const STATUS_KEY = "codex-quota";

export default function codexQuota(pi: ExtensionAPI) {
	let status: ReturnType<typeof createQuotaStatus> | undefined;

	function stop() {
		status?.stop();
		status = undefined;
	}

	function selectProvider(ctx: ExtensionContext, selected: string | undefined) {
		if (ctx.mode !== "tui" || selected !== CODEX_PROVIDER) {
			stop();
			return;
		}
		if (status) return;
		status = createQuotaStatus(
			async (signal) => {
				const auth = await resolveCodexAuth(() => ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER), signal);
				return fetchQuota(auth, signal);
			},
			(text) => ctx.ui.setStatus(STATUS_KEY, text === undefined ? undefined : ctx.ui.theme.fg("dim", text)),
		);
		status.start();
	}

	pi.on("session_start", (_event, ctx) => { selectProvider(ctx, ctx.model?.provider); });
	pi.on("model_select", (event, ctx) => { selectProvider(ctx, event.model.provider); });
	pi.on("turn_end", (event) => {
		if (event.outcome === "completed" && event.message.role === "assistant" && event.message.provider === CODEX_PROVIDER) {
			status?.afterTurn();
		}
	});
	pi.on("session_shutdown", stop);
}
