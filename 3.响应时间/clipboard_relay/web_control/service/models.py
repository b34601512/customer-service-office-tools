#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass

from ...config import CredentialConfig, TargetConfig


@dataclass(frozen=True)
class _LoginTargetSpec:
    indicator_key: str
    browser_target_key: str
    title: str
    target: TargetConfig
    credentials: CredentialConfig
    url: str


__all__ = ["_LoginTargetSpec"]
