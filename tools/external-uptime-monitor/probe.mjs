// External reachability/TLS/reverse-proxy probes (02_42 v1.2 PARTE U §57).
// Every function accepts its low-level I/O primitive as a parameter with a
// real-world default, so tests can inject a fake implementation instead of
// touching the network (mission requirement: unit tests must not depend on
// a real external target). Only condition types the external monitor can
// actually observe from OUTSIDE the VPS are mapped here -- BACKUP_FAILED/
// BACKUP_STALE require VPS-side knowledge (backup job status/age) no
// network probe can see, so they are deliberately not implemented by this
// monitor (a disclosed scope boundary, not an oversight -- see the closure
// report). No new condition-type enum values are invented; every
// `conditionType`/`summaryCode`/`service` value below is exactly one of the
// canonical values from 02_42 §57/§56.

import net from "node:net";
import tls from "node:tls";

/** TCP-level reachability of host:port -- distinguishes DNS/connect failure (host down) from a working connection. */
export async function checkTcpReachable(host, port, timeoutMs, netModule = net) {
  return new Promise((resolve) => {
    const socket = netModule.connect({ host, port, timeout: timeoutMs });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, summaryCode: "CONNECT_TIMEOUT" }));
    socket.once("error", (error) => {
      if (error && error.code === "ENOTFOUND") {
        finish({ ok: false, summaryCode: "DNS_RESOLUTION_FAILED" });
      } else if (error && (error.code === "ECONNREFUSED" || error.code === "ECONNRESET")) {
        finish({ ok: false, summaryCode: "CONNECT_REFUSED" });
      } else {
        finish({ ok: false, summaryCode: "CONNECT_TIMEOUT" });
      }
    });
  });
}

/** TLS handshake + certificate expiry check. Only meaningful once TCP connect already succeeded. */
export async function checkTlsHandshake(host, port, timeoutMs, tlsModule = tls) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tlsModule.connect({ host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: true }, () => {
      if (settled) return;
      settled = true;
      const cert = socket.getPeerCertificate();
      let daysRemaining = null;
      if (cert && cert.valid_to) {
        const validTo = new Date(cert.valid_to);
        daysRemaining = Math.floor((validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      }
      socket.end();
      resolve({ ok: true, daysRemaining });
    });
    socket.once("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: false, summaryCode: "TLS_HANDSHAKE_ERROR" });
    });
    socket.once("error", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, summaryCode: "TLS_HANDSHAKE_ERROR" });
    });
  });
}

/** HTTP(S) health-endpoint check -- status code + latency. */
export async function checkHttpHealth(url, timeoutMs, fetchImpl = fetch) {
  const start = Date.now();
  try {
    const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - start;
    return { ok: response.ok, status: response.status, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    if (error && error.name === "TimeoutError") {
      return { ok: false, status: null, latencyMs, summaryCode: "CONNECT_TIMEOUT" };
    }
    return { ok: false, status: null, latencyMs, summaryCode: "CONNECT_REFUSED" };
  }
}

/**
 * Runs the full probe sequence and classifies the result into exactly one
 * of: Level 1 (unreachable, 02_42 §6/§57), or zero-or-more Level 2 degraded
 * conditions (02_42 §57), or fully healthy. TCP is checked first (cheapest,
 * most fundamental signal); TLS and HTTP are only attempted if TCP
 * succeeded, since attempting them against a dead host would just
 * rediscover the same unreachability through a slower/less specific path.
 */
export async function runProbe(config, deps = {}) {
  const {
    checkTcpReachable: tcpCheck = checkTcpReachable,
    checkTlsHandshake: tlsCheck = checkTlsHandshake,
    checkHttpHealth: httpCheck = checkHttpHealth,
  } = deps;

  const {
    host,
    tlsPort = 443,
    healthUrl,
    timeoutMs = 10_000,
    tlsExpiryWarningDays = 14,
    httpLatencyThresholdMs = 3000,
  } = config;

  const tcp = await tcpCheck(host, tlsPort, timeoutMs);
  if (!tcp.ok) {
    return {
      reachable: false,
      level1: {
        conditionType: "VPS_UNREACHABLE",
        service: "HOST",
        summaryCode: tcp.summaryCode,
        evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 1 },
      },
      level2Conditions: [],
    };
  }

  const tlsResult = await tlsCheck(host, tlsPort, timeoutMs);
  if (!tlsResult.ok) {
    return {
      reachable: false,
      level1: {
        conditionType: "TLS_HANDSHAKE_FAILURE",
        service: "TLS",
        summaryCode: tlsResult.summaryCode,
        evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: null, backupAgeHours: null, consecutiveFailures: 1 },
      },
      level2Conditions: [],
    };
  }

  const http = await httpCheck(healthUrl, timeoutMs);
  if (!http.ok) {
    // TCP and TLS both succeeded, so the host itself is up -- an HTTP
    // failure at this point means the reverse proxy in front of the
    // application is not serving requests, not that the host is down.
    return {
      reachable: false,
      level1: {
        conditionType: "REVERSE_PROXY_UNREACHABLE",
        service: "REVERSE_PROXY",
        summaryCode: http.summaryCode ?? "HTTP_STATUS_ERROR",
        evidence: { httpStatus: http.status, latencyMs: http.latencyMs, tlsDaysRemaining: tlsResult.daysRemaining, backupAgeHours: null, consecutiveFailures: 1 },
      },
      level2Conditions: [],
    };
  }

  const level2Conditions = [];
  if (typeof tlsResult.daysRemaining === "number" && tlsResult.daysRemaining < tlsExpiryWarningDays) {
    level2Conditions.push({
      conditionType: "TLS_EXPIRY_WARNING",
      service: "TLS",
      summaryCode: "CERTIFICATE_EXPIRED_SOON",
      evidence: { httpStatus: null, latencyMs: null, tlsDaysRemaining: tlsResult.daysRemaining, backupAgeHours: null, consecutiveFailures: 0 },
    });
  }
  if (http.latencyMs > httpLatencyThresholdMs) {
    level2Conditions.push({
      conditionType: "EXTERNAL_HTTP_DEGRADED",
      service: "API",
      summaryCode: "HTTP_LATENCY_EXCEEDED",
      evidence: { httpStatus: http.status, latencyMs: http.latencyMs, tlsDaysRemaining: tlsResult.daysRemaining, backupAgeHours: null, consecutiveFailures: 0 },
    });
  }

  return { reachable: true, level1: null, level2Conditions };
}
