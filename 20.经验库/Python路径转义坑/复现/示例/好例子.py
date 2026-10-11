# 演示用「好例子」：路径全部用 raw 字符串 / pathlib，扫描器应当说「干净」
from pathlib import Path

档案 = Path(r"D:\档案") / "2026" / "7月" / "报告.txt"
缓存 = r"C:\temp\task.txt"
日志 = r"C:\reports\new\run.log"

if __name__ == "__main__":
    print(repr(str(档案)), repr(缓存), repr(日志))
