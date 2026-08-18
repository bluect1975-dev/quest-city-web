import os from "node:os";
import { statfs } from "node:fs/promises";
import type { MetricSampleStatus } from "../repository/operational-metric-sample-repository";

export interface HostMetricSample {
  metricKey: string;
  value: number;
  unit: string;
  status: MetricSampleStatus;
  threshold: number | null;
}

/**
 * Local-first host metric collection (02_42 §20, mission §20): only safe,
 * read-only runtime/system APIs (`node:os`, `node:fs/promises`), never a
 * shell command, never a client-provided command. No Docker socket
 * exposure, no filesystem explorer, no environment dump.
 */
export function collectCpuLoad(thresholdPercent = 85): HostMetricSample {
  // 1-minute load average as a percentage of available cores -- a
  // pragmatic, portable proxy (Windows loadavg() always returns 0, so
  // this degrades to UNKNOWN there rather than lying).
  const load1 = os.loadavg()[0] ?? 0;
  const cores = os.cpus().length || 1;
  if (load1 === 0 && process.platform === "win32") {
    return { metricKey: "cpu_load_percent", value: 0, unit: "percent", status: "UNKNOWN", threshold: thresholdPercent };
  }
  const percent = Math.min(100, Math.round((load1 / cores) * 100));
  const status: MetricSampleStatus = percent >= thresholdPercent ? "CRITICAL" : percent >= thresholdPercent * 0.8 ? "WARNING" : "OK";
  return { metricKey: "cpu_load_percent", value: percent, unit: "percent", status, threshold: thresholdPercent };
}

export function collectMemoryUsage(thresholdPercent = 85): HostMetricSample {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const status: MetricSampleStatus =
    usedPercent >= thresholdPercent ? "CRITICAL" : usedPercent >= thresholdPercent * 0.8 ? "WARNING" : "OK";
  return { metricKey: "memory_used_percent", value: usedPercent, unit: "percent", status, threshold: thresholdPercent };
}

export async function collectDiskUsage(path: string, thresholdPercent = 85): Promise<HostMetricSample> {
  try {
    const stats = await statfs(path);
    const total = stats.blocks;
    const free = stats.bfree;
    const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
    const status: MetricSampleStatus =
      usedPercent >= thresholdPercent ? "CRITICAL" : usedPercent >= thresholdPercent * 0.8 ? "WARNING" : "OK";
    return { metricKey: "disk_used_percent", value: usedPercent, unit: "percent", status, threshold: thresholdPercent };
  } catch {
    // statfs is unsupported on some platforms (e.g. certain Windows dev
    // hosts) -- UNKNOWN, never a fabricated OK (02_42 §21, health model).
    return { metricKey: "disk_used_percent", value: 0, unit: "percent", status: "UNKNOWN", threshold: thresholdPercent };
  }
}

export async function collectHostMetrics(diskPath = "/"): Promise<HostMetricSample[]> {
  return [collectCpuLoad(), collectMemoryUsage(), await collectDiskUsage(diskPath)];
}
