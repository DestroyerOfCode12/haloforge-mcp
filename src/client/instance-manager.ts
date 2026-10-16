/**
 * HaloForge MCP | Instance manager
 *
 * Holds one HaloClient per configured instance and resolves the optional
 * `instance` argument every tool accepts.
 */

import { HaloConfig } from "../types/config.js";
import { HaloClient, ClientOptions } from "./halo-client.js";

export class InstanceManager {
  private readonly clients = new Map<string, HaloClient>();
  private readonly configs = new Map<string, HaloConfig>();
  readonly defaultName: string;

  constructor(instances: HaloConfig[], defaultName?: string, clientOptions?: ClientOptions, clients?: Map<string, HaloClient>) {
    if (instances.length === 0) throw new Error("At least one instance is required");
    for (const config of instances) {
      this.configs.set(config.name, config);
      this.clients.set(config.name, clients?.get(config.name) ?? new HaloClient(config, clientOptions));
    }
    this.defaultName = defaultName ?? instances[0].name;
    if (!this.configs.has(this.defaultName)) throw new Error(`Default instance "${this.defaultName}" is not configured`);
  }

  names(): string[] {
    return [...this.configs.keys()];
  }

  allConfigs(): HaloConfig[] {
    return [...this.configs.values()];
  }

  /** Resolve an instance by name (case insensitive), or the default when omitted. */
  resolve(name?: string): { client: HaloClient; config: HaloConfig } {
    const key = (name ?? this.defaultName).trim().toLowerCase();
    const config = this.configs.get(key);
    const client = this.clients.get(key);
    if (!config || !client) {
      throw new Error(`Unknown instance "${name}". Configured instances: ${this.names().join(", ")}`);
    }
    return { client, config };
  }
}
