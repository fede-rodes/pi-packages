import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fetchQuota } from "./quota.ts";
import { createQuotaStatus } from "./status.ts";

const provider = "openai-codex";
const statusKey = "codex-quota";

export default function codexQuota(pi: ExtensionAPI) {
	let status: ReturnType<typeof createQuotaStatus> | undefined;

	function stop() {
		status?.stop();
		status = undefined;
	}

	function selectProvider(ctx: ExtensionContext, selected: string | undefined) {
		if (ctx.mode !== "tui" || selected !== provider) {
			stop();
			return;
		}
		if (status) return;
		status = createQuotaStatus(
			(signal) => fetchQuota(() => ctx.modelRegistry.getApiKeyForProvider(provider), signal),
			(text) => ctx.ui.setStatus(statusKey, text === undefined ? undefined : ctx.ui.theme.fg("dim", text)),
		);
		status.start();
	}

	pi.on("session_start", (_event, ctx) => { selectProvider(ctx, ctx.model?.provider); });
	pi.on("model_select", (event, ctx) => { selectProvider(ctx, event.model.provider); });
	pi.on("turn_end", (event) => {
		if (event.outcome === "completed" && event.message.role === "assistant" && event.message.provider === provider) {
			status?.afterTurn();
		}
	});
	pi.on("session_shutdown", stop);
}
