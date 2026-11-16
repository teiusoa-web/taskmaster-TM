// The dev/prod web server proxies these routes to its internal services.
// Using the current origin keeps API and upload calls on the deployed host.
export const API_BASE = window.location.origin;
export const UPLOAD_BASE = window.location.origin;
export const DEFAULT_API_TIMEOUT_MS = 65000;

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function warmUpBackend() {
  return fetch('/health', { cache: 'no-store' }).catch(() => null);
}

export function startKeepAlivePing(intervalMs = 10 * 60 * 1000) {
  if (window.__tmKeepAliveStarted) return;
  window.__tmKeepAliveStarted = true;
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      warmUpBackend();
    }
  }, intervalMs);
}

export async function fetchWithRetry(url, options = {}, config = {}) {
  const timeoutMs = Number(config.timeoutMs) || DEFAULT_API_TIMEOUT_MS;
  const maxRetries = Number.isInteger(config.retries) ? config.retries : 2;
  const retryDelayMs = Number(config.retryDelayMs) || 2000;
  const externalSignal = options.signal;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(externalSignal.reason || 'EXTERNAL_ABORT');
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason || 'EXTERNAL_ABORT');
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort('REQUEST_TIMEOUT');
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        if (typeof config.onRetry === 'function') config.onRetry(attempt + 1, maxRetries);
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      const isTimeoutOrNetwork = timedOut || error === 'REQUEST_TIMEOUT' || error?.name === 'AbortError' || error instanceof TypeError;
      if (externalSignal?.aborted) throw error;
      if (isTimeoutOrNetwork && attempt < maxRetries) {
        if (typeof config.onRetry === 'function') config.onRetry(attempt + 1, maxRetries);
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }
      if (isTimeoutOrNetwork) {
        const friendly = new Error('Máy chủ đang khởi động lại (Cold Start) hoặc phản hồi chậm. Vui lòng thử lại sau vài giây.');
        friendly.isTransient = true;
        throw friendly;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
