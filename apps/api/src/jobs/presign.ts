// SPDX-License-Identifier: AGPL-3.0-or-later
// Presigned R2 URLs for job files in production (M10.5, ADR-095 item 4, ADR-098). R2 speaks the
// S3 API, so a URL is signed with AWS Signature Version 4 in the query string: anyone holding
// it may GET or PUT that one object until it expires, and nothing else. Pure apart from the
// Web Crypto calls, so it is checked against AWS's published example (test/presign.test.ts).

/** What signing needs: the access key, the account's S3 endpoint and the bucket. */
export interface R2Signer {
  accessKeyId: string;
  secretAccessKey: string;
  /** For R2, `https://<account id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** Named in the path; empty when the endpoint's host already names it (virtual-hosted style). */
  bucket: string;
  /** "auto" for R2. */
  region: string;
}

/** The longest validity S3 and R2 accept for a presigned URL: 7 days. */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(text));
}

/** RFC 3986 encoding as SigV4 wants it: everything but A-Z a-z 0-9 - . _ ~ is escaped. */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `20130524T000000Z` for a date. */
function amzDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A presigned URL for one object. Path-style (`<endpoint>/<bucket>/<key>`), host the only
 * signed header and the payload unsigned, so the worker can send any body and its own
 * Content-Type and Content-Length (R2 checks the length itself).
 */
export async function presignUrl(
  signer: R2Signer,
  method: "GET" | "PUT",
  key: string,
  expiresSeconds: number,
  at: Date = new Date(),
): Promise<string> {
  const seconds = Math.max(1, Math.min(MAX_PRESIGN_SECONDS, Math.ceil(expiresSeconds)));
  const endpoint = new URL(signer.endpoint);
  const path = `/${[...(signer.bucket ? [signer.bucket] : []), ...key.split("/")].map(uriEncode).join("/")}`;
  const stamp = amzDate(at);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${signer.region}/s3/aws4_request`;
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${signer.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(seconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = [method, path, canonicalQuery, `host:${endpoint.host}\n`, "host", "UNSIGNED-PAYLOAD"].join(
    "\n",
  );
  const toSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    hex(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest))),
  ].join("\n");
  let signingKey = await hmac(encoder.encode(`AWS4${signer.secretAccessKey}`), day);
  for (const part of [signer.region, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, toSign));
  return `${endpoint.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
