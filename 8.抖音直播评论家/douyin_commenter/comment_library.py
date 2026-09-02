#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from .config import CommentConfig


def enabled_comments(comments: tuple[CommentConfig, ...]) -> tuple[CommentConfig, ...]:
    # 该函数用于取出当前可发送评论，避免发送面板反复关心启用状态。
    out = tuple(comment for comment in comments if comment.enabled and comment.text.strip())
    if not out:
        raise RuntimeError("评论库没有启用内容，请先在评论库弹窗启用至少一条评论。")
    return out


def pick_least_sent_comment(comments: tuple[CommentConfig, ...]) -> CommentConfig:
    # 该函数用于取发送次数最少的评论，保持规则简单可解释。
    pool = list(enabled_comments(comments))
    min_sent_count = min(comment.sent_count for comment in pool)
    return next(comment for comment in pool if comment.sent_count == min_sent_count)


__all__ = ["enabled_comments", "pick_least_sent_comment"]
