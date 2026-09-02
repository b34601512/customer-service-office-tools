from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from video_compressor.compression.bitrate_calculator import (
    build_compression_plan,
    calculate_target_total_bitrate,
    estimate_target_bytes,
)
from video_compressor.compression.compression_engine import compress_video_file
from video_compressor.media.ffmpeg_provider import get_ffmpeg_executable
from video_compressor.utils.subprocess_window import get_hidden_process_kwargs


class BitrateCalculatorTests(unittest.TestCase):
    def test_build_compression_plan_should_keep_positive_video_bitrate(self) -> None:
        total_bitrate_kbps = calculate_target_total_bitrate(30, 25)
        plan = build_compression_plan(total_bitrate_kbps)

        self.assertGreater(plan.video_bitrate_kbps, 0)
        self.assertGreater(plan.audio_bitrate_kbps, 0)
        self.assertEqual(estimate_target_bytes(25), 25 * 1024 * 1024)


class SubprocessWindowTests(unittest.TestCase):
    def test_get_hidden_process_kwargs_should_match_current_platform(self) -> None:
        hidden_kwargs = get_hidden_process_kwargs()

        if os.name == "nt":
            self.assertIn("startupinfo", hidden_kwargs)
            self.assertIn("creationflags", hidden_kwargs)
        else:
            self.assertEqual(hidden_kwargs, {})


class CompressionEngineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ffmpeg_path = get_ffmpeg_executable()

    def test_compress_video_file_should_output_under_target_size(self) -> None:
        with tempfile.TemporaryDirectory(prefix="video_compressor_test_") as temp_dir:
            temp_root = Path(temp_dir)
            input_path = temp_root / "input.mp4"
            output_dir = temp_root / "output"
            progress_updates = []

            self.build_sample_video(input_path)
            self.assertGreater(input_path.stat().st_size, 1 * 1024 * 1024)

            result = compress_video_file(
                input_path,
                1.0,
                output_dir,
                self.ffmpeg_path,
                progress_callback=progress_updates.append,
            )

            self.assertTrue(result.output_path.exists())
            self.assertLessEqual(result.output_size_bytes, 1 * 1024 * 1024)
            self.assertEqual(result.output_path.parent, output_dir.resolve())
            self.assertTrue(any(update.phase_name == "第一遍压缩" for update in progress_updates))
            self.assertTrue(any(update.phase_name == "第二遍压缩" for update in progress_updates))
            self.assertTrue(any(update.phase_percent > 0 for update in progress_updates))
            self.assertEqual(progress_updates[-1].phase_name, "保存结果")
            self.assertEqual(progress_updates[-1].phase_percent, 100.0)

    def build_sample_video(self, output_path: Path) -> None:
        """生成一个可重复的测试视频，确保集成测试不依赖外部素材。"""
        command = [
            self.ffmpeg_path,
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=44100",
            "-t",
            "8",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-b:v",
            "4500k",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            str(output_path),
        ]

        subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            check=True,
            **get_hidden_process_kwargs(),
        )


if __name__ == "__main__":
    unittest.main()
