import type { ServerResponse } from "node:http";
import type { ProxyOptions } from "vite";

/** Vite's default error handler only ends responses before headers are sent.
 * An interrupted SSE response already has headers, so it otherwise occupies
 * a browser HTTP/1 slot indefinitely after the upstream API restarts. */
export function finishInterruptedProxyResponse(res: ServerResponse) {
  if (res.headersSent && !res.writableEnded && !res.destroyed) res.end();
}

export const configureProxyCleanup: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  proxy.on("error", (_error, _request, response) => {
    if ("headersSent" in response) finishInterruptedProxyResponse(response);
    // Preserve Vite's normal 500 response for failures before headers.
  });
  proxy.on("proxyRes", (upstream, _request, response) => {
    const finish = () => finishInterruptedProxyResponse(response);
    upstream.once("aborted", finish);
    upstream.once("error", finish);
  });
};
