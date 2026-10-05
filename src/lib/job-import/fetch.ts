import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import zlib from "node:zlib";
import { ImportError } from "./errors";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const HTML_TYPES = ["text/html", "application/xhtml+xml"];

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "Accept-Language": "en",
  "Accept-Encoding": "gzip, deflate, br",
};

// Everything that is not the public internet: this machine, private networks,
// link-local (which holds the cloud metadata address), carrier NAT, multicast,
// and ranges set aside for documentation or future use.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

// IPv6 forms that carry an IPv4 address inside them: mapped, compatible, NAT64 and 6to4.
const EMBEDDED_IPV4 = new BlockList();
EMBEDDED_IPV4.addSubnet("::ffff:0:0", 96, "ipv6");
EMBEDDED_IPV4.addSubnet("::", 96, "ipv6");
EMBEDDED_IPV4.addSubnet("64:ff9b::", 96, "ipv6");
const SIX_TO_FOUR = new BlockList();
SIX_TO_FOUR.addSubnet("2002::", 16, "ipv6");

function expandIpv6(address: string) {
  let text = address.split("%")[0].toLowerCase();
  // A dotted IPv4 tail becomes two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text =
      text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = text.includes("::") ? Array(8 - left.length - right.length).fill("0") : [];
  return [...left, ...fill, ...right].map((group) => parseInt(group || "0", 16));
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  if (blocked.check(address, "ipv6")) return false;

  const groups = expandIpv6(address);
  const ipv4 = (high: number, low: number) =>
    [high >> 8, high & 255, low >> 8, low & 255].join(".");
  if (EMBEDDED_IPV4.check(address, "ipv6")) return isPublicAddress(ipv4(groups[6], groups[7]));
  if (SIX_TO_FOUR.check(address, "ipv6")) return isPublicAddress(ipv4(groups[1], groups[2]));
  return true;
}

type Address = { address: string; family: number };

export type FetchTarget = { url: URL; address: Address };

export type RawResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  // Already decompressed.
  body: AsyncIterable<Buffer>;
};

// The two things that touch the network. Tests replace them.
export type FetchDeps = {
  lookup(hostname: string): Promise<Address[]>;
  send(target: FetchTarget, signal: AbortSignal): Promise<RawResponse>;
};

function decompress(response: http.IncomingMessage): AsyncIterable<Buffer> {
  const encoding = (response.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

// Connects to the address that was checked, never to whatever the name
// resolves to a moment later. The name is still used for TLS and the Host header.
function send({ url, address }: FetchTarget, signal: AbortSignal): Promise<RawResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: REQUEST_HEADERS,
        signal,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) {
            callback(null, [address]);
          } else {
            callback(null, address.address, address.family);
          }
        },
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name] = Array.isArray(value) ? value[0] : value;
        }
        resolve({ status: response.statusCode ?? 0, headers, body: decompress(response) });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const defaultDeps: FetchDeps = {
  lookup: (hostname) => dnsLookup(hostname, { all: true }),
  send,
};

// Checks the URL and where its name points. Throws when it is not a plain
// public web address.
async function resolveTarget(url: URL, deps: FetchDeps): Promise<FetchTarget> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImportError("notAllowed");
  // An empty port means the default one. Anything else was typed.
  if (url.port !== "" || url.username !== "" || url.password !== "") {
    throw new ImportError("notAllowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  let addresses: Address[];
  if (family) {
    addresses = [{ address: hostname, family }];
  } else {
    try {
      addresses = await deps.lookup(hostname);
    } catch (error) {
      throw new ImportError("unreachable", { cause: error });
    }
  }
  if (addresses.length === 0) throw new ImportError("unreachable");
  // One bad address is enough: a name must not point both outside and inside.
  if (!addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new ImportError("notAllowed");
  }
  return { url, address: addresses[0] };
}

async function readBody(response: RawResponse) {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ImportError("tooLarge");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ImportError("tooLarge");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export type FetchedPage = { url: string; contentType: string; body: Buffer };

function parseUrl(text: string, base?: URL) {
  try {
    return new URL(text, base);
  } catch {
    throw new ImportError("notAllowed");
  }
}

// Fetches a page a user pointed at, without letting the request reach
// anything but the public web.
export async function safeFetch(input: string, deps: FetchDeps = defaultDeps): Promise<FetchedPage> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let url = parseUrl(input.trim());

  try {
    for (let redirects = 0; ; redirects++) {
      const target = await resolveTarget(url, deps);
      const response = await deps.send(target, deadline);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirects >= MAX_REDIRECTS) throw new ImportError("unreachable");
        // Every hop is checked again from scratch.
        url = parseUrl(location, url);
        continue;
      }
      // 999 is LinkedIn's "no robots" answer.
      if ([401, 403, 407, 429, 451, 999].includes(response.status)) throw new ImportError("blocked");
      if (response.status < 200 || response.status >= 300) throw new ImportError("unreachable");

      const contentType = (response.headers["content-type"] ?? "").toLowerCase();
      if (!HTML_TYPES.includes(contentType.split(";")[0].trim())) throw new ImportError("notHtml");

      return { url: url.toString(), contentType, body: await readBody(response) };
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // A timeout, a refused connection, a bad certificate or a broken response.
    throw new ImportError("unreachable", { cause: error });
  }
}
