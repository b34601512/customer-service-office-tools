#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
from pathlib import Path

from ..config import CredentialConfig


def account_profile_key(credentials: CredentialConfig) -> str:
    # 该函数用于按账号生成不可逆资料目录名，防止账号名泄露到路径里。
    username = str(credentials.username or "").strip()
    if not username:
        return "manual"
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()[:12]
    return f"account-{digest}"


def user_data_dir(*, profile_root: Path, executable: str, target_key: str, credentials: CredentialConfig) -> Path:
    # 该函数用于按浏览器、目标页面、账号三层隔离登录态。
    return Path(profile_root) / Path(executable).stem.lower() / str(target_key) / account_profile_key(credentials)


__all__ = ["account_profile_key", "user_data_dir"]
