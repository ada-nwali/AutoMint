/**
 * Next.js instrumentation entry point.
 *
 * Next.js calls `register()` once per server worker startup, and
 * `onRequestError()` for every unhandled server-side error.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./src/lib/sentry.server");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./src/lib/sentry.server");
  }
}

export const onRequestError = async (
  err: Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
  },
) => {
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(err, request, context);
};
