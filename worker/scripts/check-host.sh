#!/usr/bin/env bash
set -eu

SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"

check() {
  if "$@" >/dev/null 2>&1; then
    echo "[ok] $*"
  else
    echo "[missing] $*"
    return 1
  fi
}

failures=0
check test -c /dev/kvm || failures=$((failures + 1))
check test -x "$SDK_ROOT/emulator/emulator" || failures=$((failures + 1))
check test -x "$SDK_ROOT/platform-tools/adb" || failures=$((failures + 1))
check test -x "$SDK_ROOT/cmdline-tools/latest/bin/avdmanager" || failures=$((failures + 1))

if [ "$failures" -gt 0 ]; then
  echo "Host is not ready: $failures requirement(s) missing."
  exit 1
fi

echo "Host is ready for the Android worker."
