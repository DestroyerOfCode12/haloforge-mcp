/**
 * HaloForge MCP | Safety policy
 *
 * Decides which tools are registered and whether a given call may run
 * against a given instance.
 */

import { HaloConfig } from "../types/config.js";

export type ToolAccess = "read" | "write" | "delete";

export function canWrite(instance: HaloConfig): boolean {
  return instance.mode === "write" || instance.mode === "full";
}

export function canDelete(instance: HaloConfig): boolean {
  return instance.mode === "full" && instance.disableDelete === false;
}

/** True when the resource is on the instance's write allowlist (or there is no allowlist). */
export function isAllowlisted(instance: HaloConfig, resourceNames: string[]): boolean {
  if (!instance.writeAllowlist) return true;
  return resourceNames.some((n) => instance.writeAllowlist!.has(n.toLowerCase()));
}

/** A tool is registered when at least one instance could use it. */
export function shouldRegister(access: ToolAccess, instances: HaloConfig[]): boolean {
  if (access === "read") return true;
  if (access === "write") return instances.some(canWrite);
  return instances.some(canDelete);
}

/**
 * Returns null when the call is allowed, otherwise a reason it is refused.
 * Dry runs of writes only read, so they are allowed on any instance. The
 * caller must only pass dryRun for tools that really honour it, and never
 * for deletes.
 */
export function checkAccess(
  access: ToolAccess,
  instance: HaloConfig,
  resourceNames: string[],
  dryRun = false
): string | null {
  if (access === "read" || (dryRun && access === "write")) return null;
  if (access === "write" && !canWrite(instance)) {
    return `Instance "${instance.name}" is in ${instance.mode} mode. Set HALO_MODE (or HALO_${instance.name.toUpperCase()}_MODE) to write or full to allow changes. Use dry_run: true to preview.`;
  }
  if (access === "delete" && !canDelete(instance)) {
    return `Delete is disabled on instance "${instance.name}". It needs mode full and HALO_DISABLE_DELETE=false.`;
  }
  if (resourceNames.length > 0 && !isAllowlisted(instance, resourceNames)) {
    return `Resource ${resourceNames[0]} is not on the write allowlist for instance "${instance.name}".`;
  }
  return null;
}
