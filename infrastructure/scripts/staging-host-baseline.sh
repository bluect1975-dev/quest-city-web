#!/usr/bin/env bash
# Quest City Web — staging VPS host baseline template (Tranche E mission
# §29/§31-33; 07_06 §7-8). NOT executed by any automation in this
# repository — an operator runs this manually, ONCE, on an explicitly
# authorized staging VPS, after reading it end to end. It is a template to
# adapt, not a black box to pipe into `sh`.
#
# Assumes a Debian/Ubuntu LTS host (the most common baseline for a small
# self-hosted VPS at this scale) with `ufw` available. Adjust for a
# different distribution's firewall/package tooling as needed — the
# PRINCIPLES below (default-deny inbound, only 80/443/SSH exposed, no
# password SSH, automatic security patching, NTP sync) are the actual
# requirement; the exact commands are one reasonable implementation of them.

set -euo pipefail

echo "== Firewall: default deny inbound, allow only what's needed =="
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp   comment "HTTP - redirect/ACME only, see nginx.staging.conf"
ufw allow 443/tcp  comment "HTTPS - application traffic"
# Replace 22 with your actual SSH port if you've moved it off the default.
# If your operators have static/predictable source IPs, restrict further:
#   ufw allow from <your-ip>/32 to any port 22 proto tcp
ufw limit 22/tcp comment "SSH - rate-limited against brute force"
ufw --force enable
ufw status verbose

echo "== Time sync (correlationId/log/certificate timestamps depend on this) =="
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl set-ntp true
fi

echo "== Automatic security updates =="
if command -v unattended-upgrades >/dev/null 2>&1 || apt-cache show unattended-upgrades >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y unattended-upgrades
  dpkg-reconfigure -f noninteractive unattended-upgrades
fi

cat <<'MANUAL_STEPS'

== Manual steps this script deliberately does NOT automate ==
(Editing sshd_config or PAM blindly is the single easiest way to lock
yourself out of a remote VPS — do these by hand, verified, with a second
session open as a safety net.)

1. SSH key-only authentication:
   In /etc/ssh/sshd_config, set:
     PasswordAuthentication no
     PermitRootLogin no
     PubkeyAuthentication yes
   Then: systemctl reload sshd
   VERIFY key-based login works in a NEW terminal session BEFORE closing
   your current one.

2. Individual, nominative admin accounts (07_06 §8: "account nominativi,
   non condivisi"):
   adduser <operator-name>
   usermod -aG sudo <operator-name>
   Add THEIR OWN public key to ~<operator-name>/.ssh/authorized_keys —
   never share one shared key/account across operators.

3. sudo logging (07_06 §8: "sudo tracciato"):
   Confirmed on by default via /var/log/auth.log on Debian/Ubuntu — verify
   it's actually being retained/rotated (check /etc/logrotate.d/rsyslog).

4. Least installed packages:
   Review `dpkg -l` against what this stack actually needs (Docker Engine,
   ufw, unattended-upgrades, and nothing else running as a service) —
   remove anything installed by the base image that this deployment
   doesn't use.

5. Disk encryption:
   If the provider offers encrypted block storage (design report §5's
   provider requirement), verify it's actually enabled for THIS volume —
   provider defaults vary and are not something this script can check
   remotely.

MANUAL_STEPS

echo "Host baseline template complete. Review the manual steps above before considering this VPS staging-ready."
