#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time

from .customer_selection import ensure_first_consulting_customer_selected
from .finder import find_reply_input
from .metadata import _read_reply_input_meta
from .preparation import _activate_reply_input, _prepare_reply_input_for_write
from .reader import _read_reply_input_value_from_page, read_input_value
from .send_action import click_send_button_or_enter
from .state import (
    _bool_text,
    _combine_errors,
    _default_reply_input_meta,
    _meta_from_reply_input_state,
    _read_reply_input_ready_state,
    _read_reply_input_state,
    _reply_input_ready_summary,
    _reply_input_state_summary,
)
from .text_utils import _preview_text, normalize_editor_text
from .writer import (
    _log_write_attempt,
    _set_reply_input_via_dom,
    _set_reply_input_via_page_dom,
    _wait_for_reply_input_value,
    overwrite_reply_input,
)

__all__ = [
    "normalize_editor_text",
    "find_reply_input",
    "read_input_value",
    "overwrite_reply_input",
    "ensure_first_consulting_customer_selected",
    "click_send_button_or_enter",
    "_preview_text",
    "_read_reply_input_state",
    "_reply_input_state_summary",
    "_bool_text",
    "_read_reply_input_ready_state",
    "_reply_input_ready_summary",
    "_default_reply_input_meta",
    "_meta_from_reply_input_state",
    "_combine_errors",
    "_activate_reply_input",
    "_prepare_reply_input_for_write",
    "_read_reply_input_meta",
    "_read_reply_input_value_from_page",
    "_wait_for_reply_input_value",
    "_set_reply_input_via_dom",
    "_set_reply_input_via_page_dom",
    "_log_write_attempt",
]
