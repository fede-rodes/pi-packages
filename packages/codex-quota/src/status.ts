import { formatQuota, type QuotaWindow } from "./quota.ts";

/**
 * Controls what the quota line shows and when it refreshes. Starts in a loading
 * state, limits turn-triggered refreshes to once per minute, and updates reset
 * countdowns locally. Also handles timeouts, stale values, and cleanup.
 */

const REFRESH_INTERVAL_MS = 60_000;
const COUNTDOWN_TICK_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function createQuotaStatus(
	loadQuota: (signal: AbortSignal) => Promise<QuotaWindow[]>,
	setStatus: (text: string | undefined) => void,
) {
	let active = false;
	let windows: QuotaWindow[] | undefined;
	let stale = false;
	let lastStartedAt = 0;
	let pending = false;
	let inFlight: { abort: AbortController; timeout: ReturnType<typeof setTimeout> } | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let displayTimer: ReturnType<typeof setInterval> | undefined;

	function showWindows() {
		if (windows) setStatus(formatQuota(windows, Date.now()) + (stale ? " · stale" : ""));
	}

	function scheduleRefresh() {
		if (!active || !pending || inFlight || refreshTimer !== undefined) return;
		const wait = REFRESH_INTERVAL_MS - (Date.now() - lastStartedAt);
		if (wait <= 0) {
			refresh();
		} else {
			refreshTimer = setTimeout(() => {
				refreshTimer = undefined;
				scheduleRefresh();
			}, wait);
		}
	}

	function refresh() {
		pending = false;
		lastStartedAt = Date.now();
		const abort = new AbortController();
		function finish(next?: QuotaWindow[]) {
			// A timeout, shutdown, or newer request may have superseded this result.
			if (inFlight?.abort !== abort) return;
			clearTimeout(inFlight.timeout);
			inFlight = undefined;
			if (next?.length) windows = next;
			stale = !next?.length;
			if (windows) showWindows();
			else setStatus("quota unavailable");
			scheduleRefresh();
		}
		inFlight = {
			abort,
			timeout: setTimeout(() => {
				abort.abort();
				finish();
			}, REQUEST_TIMEOUT_MS),
		};
		void Promise.resolve().then(() => {
			abort.signal.throwIfAborted();
			return loadQuota(abort.signal);
		}).then(finish, () => finish());
	}

	return {
		start() {
			if (active) return;
			active = true;
			setStatus("quota loading…");
			displayTimer = setInterval(showWindows, COUNTDOWN_TICK_MS);
			refresh();
		},
		afterTurn() {
			if (!active) return;
			pending = true;
			scheduleRefresh();
		},
		stop() {
			if (!active) return;
			active = false;
			pending = false;
			clearInterval(displayTimer);
			clearTimeout(refreshTimer);
			refreshTimer = undefined;
			if (inFlight) {
				clearTimeout(inFlight.timeout);
				inFlight.abort.abort();
				inFlight = undefined;
			}
			windows = undefined;
			setStatus(undefined);
		},
	};
}
