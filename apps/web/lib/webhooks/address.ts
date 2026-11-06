import net from "node:net";

/**
 * An address a webhook must never be sent to (verikora#241): the server's own network — loopback, private, link-local (the cloud
 * metadata address), carrier-grade NAT, multicast, reserved — in IPv4, IPv6 and IPv4-mapped IPv6. Pure.
 */
const V4: [number, number][] = [
  [0x00000000, 8], // this network
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local, cloud metadata
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0000200, 24], // documentation
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved and broadcast
];

const v4n = (ip: string) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);

export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4)
    return V4.some(([base, bits]) => Math.floor(v4n(ip) / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (
      lower === "::" ||
      lower === "::1" ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00 ||
      lower.startsWith("2001:db8")
    );
  }
  return true; // not an address at all: refuse
}
