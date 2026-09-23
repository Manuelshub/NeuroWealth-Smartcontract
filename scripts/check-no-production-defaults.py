#!/usr/bin/env python3
"""Fail CI when production-sensitive env vars have source-level defaults."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKS = {
    "whatsapp/src/cryptoUtils.ts": ("ENCRYPTION_KEY", "PHONE_HASH_SALT"),
    "frontend/src/lib/stellar.ts": ("NEXT_PUBLIC_VAULT_CONTRACT_ID",),
    "whatsapp/src/vaultRouter.ts": ("VAULT_CONTRACT_ID",),
}

FALLBACK_TEMPLATE = r"process\.env\.{name}\s*(?:\|\||\?\?)\s*(['\"`])([^'\"`]+)\1"


def main() -> int:
    failures: list[str] = []

    for relative, names in CHECKS.items():
        path = ROOT / relative
        if not path.exists():
            failures.append(f"missing expected file: {relative}")
            continue

        text = path.read_text(encoding="utf-8")
        for name in names:
            pattern = re.compile(FALLBACK_TEMPLATE.format(name=re.escape(name)))
            match = pattern.search(text)
            if match:
                failures.append(
                    f"{relative}: {name} has a hardcoded fallback value; use fail-closed env validation instead"
                )

    if failures:
        print("Production default configuration check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("No production-sensitive hardcoded env defaults found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())