// SPDX-License-Identifier: AGPL-3.0-or-later
// AWS Signature Version 4 (M10.7, ADR-095 item 6): signs the API's requests to AWS with the
// launcher's access key, using only WebCrypto, so the Worker needs no AWS SDK. Pure apart from
// the digests; the tests check it against AWS's published examples.

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignInput {
  method: string;
  url: string;
  /** Headers to sign and send; `host` and `x-amz-date` are added. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now: Date;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
}

/** RFC 3986 encoding, as SigV4 wants it: everything but unreserved characters escaped. */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** 20150830T123600Z: the request time, as SigV4 writes it. */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The headers to send: the input's, with `host`, `x-amz-date` and `authorization`. */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value.trim();
  headers.host = url.host;
  headers["x-amz-date"] = date;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonical = [
    input.method.toUpperCase(),
    url.pathname === "" ? "/" : url.pathname,
    canonicalQuery(url.searchParams),
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    signedHeaders,
    await sha256Hex(input.body),
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", date, scope, await sha256Hex(canonical)].join("\n");
  let key = await hmac(encoder.encode(`AWS4${input.credentials.secretAccessKey}`), day);
  for (const part of [input.region, input.service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
