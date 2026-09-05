"""Windows TUI 输入：只读取已到达的 Unicode 事件，不混用 CRT 字节按键协议。"""

import ctypes
from ctypes import wintypes


class KeyEvent(ctypes.Structure):
    _fields_ = [
        ("down", wintypes.BOOL), ("repeat", wintypes.WORD),
        ("virtual_key", wintypes.WORD), ("scan", wintypes.WORD),
        ("char", wintypes.WCHAR), ("control", wintypes.DWORD),
    ]


class Event(ctypes.Union):
    _fields_ = [("key", KeyEvent), ("storage", ctypes.c_byte * 16)]


class InputRecord(ctypes.Structure):
    _fields_ = [("type", wintypes.WORD), ("event", Event)]


VIRTUAL_KEYS = {
    0x08: "backspace", 0x09: "tab", 0x0D: "enter", 0x1B: "esc",
    0x21: "pgup", 0x22: "pgdn", 0x23: "end", 0x24: "home",
    0x25: "left", 0x26: "up", 0x27: "right", 0x28: "down", 0x2E: "delete",
}


class WindowsConsoleInput:
    """单一消费者；poll 批量读取现有事件，空队列立即返回。"""

    def __init__(self):
        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.GetStdHandle.argtypes = [wintypes.DWORD]
        self.api.GetStdHandle.restype = wintypes.HANDLE
        self.api.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        self.api.SetConsoleMode.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.api.GetNumberOfConsoleInputEvents.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        self.api.ReadConsoleInputW.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(InputRecord), wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.handle = self.api.GetStdHandle(-10)
        mode = wintypes.DWORD()
        self._check(self.api.GetConsoleMode(self.handle, ctypes.byref(mode)))
        self.old_mode = mode.value
        # 关闭 processed/line/echo/QuickEdit/VT input，保留 IME 等其余设置。
        # 方向键直接由虚拟键码识别；Ctrl+C 作为按键交给 TUI 统一退出。
        self._check(self.api.SetConsoleMode(self.handle, (mode.value | 0x0080) & ~0x0247))

    @staticmethod
    def _check(ok):
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())

    def poll(self):
        count = wintypes.DWORD()
        self._check(self.api.GetNumberOfConsoleInputEvents(self.handle, ctypes.byref(count)))
        if not count.value:
            return []
        records = (InputRecord * min(count.value, 64))()
        read = wintypes.DWORD()
        self._check(self.api.ReadConsoleInputW(self.handle, records, len(records), ctypes.byref(read)))
        keys = []
        for record in records[:read.value]:
            if record.type != 1 or not record.event.key.down:
                continue
            event = record.event.key
            # IME 组合过程的空事件、Shift 等修饰键不需要等待“下一字节”。
            key = event.char if event.char != "\x00" else VIRTUAL_KEYS.get(event.virtual_key)
            if key:
                keys.extend([key] * max(1, event.repeat))
        return keys

    def close(self):
        if self.old_mode is not None:
            self._check(self.api.SetConsoleMode(self.handle, self.old_mode))
            self.old_mode = None
