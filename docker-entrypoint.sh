#!/bin/sh
set -e
mkdir -p /data
# Bind-mounted ./data is often root-owned on the host; SQLite needs write access here.
chown -R app:app /data 2>/dev/null || true
exec su-exec app /sbin/tini -- "$@"
