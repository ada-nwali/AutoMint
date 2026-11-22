import type { Breadcrumb, Event } from "@sentry/nextjs";

// G/C addresses are 56 characters; muxed M addresses are 69 characters.
const STELLAR_ADDRESS_RE = /\b(?:[GC][A-Z0-9]{55}|M[A-Z0-9]{68})\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

export function scrubString(value: string): string {
  return value.replace(STELLAR_ADDRESS_RE, "[address]").replace(EMAIL_RE, "[email]");
}

export function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, scrubUnknown(nestedValue)]),
    );
  }
  return value;
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message ? { message: scrubString(breadcrumb.message) } : {}),
    ...(breadcrumb.data ? { data: scrubUnknown(breadcrumb.data) as Record<string, unknown> } : {}),
  };
}

export function scrubEvent<T extends Event>(event: T): T {
  const scrubbed = { ...event };

  if (scrubbed.message) scrubbed.message = scrubString(scrubbed.message);
  if (scrubbed.breadcrumbs) scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb);

  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((exception) => ({
        ...exception,
        ...(exception.value ? { value: scrubString(exception.value) } : {}),
        ...(exception.type ? { type: scrubString(exception.type) } : {}),
        ...(exception.mechanism
          ? { mechanism: scrubUnknown(exception.mechanism) as typeof exception.mechanism }
          : {}),
      })),
    };
  }

  if (scrubbed.request) {
    const headers = scrubbed.request.headers
      ? Object.fromEntries(
          Object.entries(scrubbed.request.headers).filter(
            ([key]) => key.toLowerCase() !== "referer",
          ),
        )
      : undefined;
    scrubbed.request = {
      ...scrubbed.request,
      ...(scrubbed.request.url ? { url: scrubString(scrubbed.request.url) } : {}),
      ...(scrubbed.request.data ? { data: scrubUnknown(scrubbed.request.data) } : {}),
      ...(scrubbed.request.query_string
        ? {
            query_string: scrubUnknown(
              scrubbed.request.query_string,
            ) as typeof scrubbed.request.query_string,
          }
        : {}),
      ...(headers ? { headers: scrubUnknown(headers) as Record<string, string> } : {}),
    };
  }

  return scrubbed;
}
