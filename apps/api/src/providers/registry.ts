import type { DnsProvider } from "./types.js";
import { duckdnsProvider } from "./duckdns.js";
import { technitiumProvider } from "./technitium.js";

const builtIn: DnsProvider[] = [duckdnsProvider, technitiumProvider];

const map = new Map<string, DnsProvider>(builtIn.map((p) => [p.type, p]));

export function getProvider(type: string): DnsProvider | undefined {
  return map.get(type);
}

export function listProviders(): DnsProvider[] {
  return Array.from(map.values());
}

/**
 * Allows extensions/tests to register additional providers at runtime
 * without modifying the registry source. The plugin architecture is
 * intentionally simple: adding a new provider in production is normally
 * done by adding a new file to this folder and importing it above.
 */
export function registerProvider(p: DnsProvider): void {
  map.set(p.type, p);
}
