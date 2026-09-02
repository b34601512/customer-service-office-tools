#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import io
import unittest
import zipfile

from douyin_commenter.comment_importer import parse_comment_import_payload, split_imported_comments


def _build_docx_bytes(paragraphs: list[str]) -> bytes:
    # 该函数用于生成最小 docx 测试文件，避免测试依赖真实 Word 软件。
    body = "".join(
        f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"
        for text in paragraphs
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


class CommentImporterTest(unittest.TestCase):
    def test_split_by_line_ignores_empty_lines(self) -> None:
        # 该测试用于确认默认导入规则是一行一条评论。
        self.assertEqual(split_imported_comments("第一条\n\n 第二条  ", "line"), ["第一条", "第二条"])

    def test_split_by_sentence_keeps_delimiters(self) -> None:
        # 该测试用于确认按标点导入时保留句末语气。
        self.assertEqual(
            split_imported_comments("第一条。第二条；第三条", "sentence"),
            ["第一条。", "第二条；", "第三条"],
        )

    def test_split_by_custom_delimiters_removes_duplicates(self) -> None:
        # 该测试用于确认自定义分隔符导入时不会重复污染评论库。
        self.assertEqual(split_imported_comments("甲|乙|甲", "custom", "|"), ["甲", "乙"])

    def test_parse_txt_payload(self) -> None:
        # 该测试用于确认 TXT 文件可通过接口 payload 解析。
        content = base64.b64encode("评论A\n评论B".encode("utf-8")).decode("ascii")
        result = parse_comment_import_payload({"file_name": "comments.txt", "content_base64": content, "split_mode": "line"})
        self.assertEqual([item["text"] for item in result["comments"]], ["评论A", "评论B"])

    def test_parse_docx_payload(self) -> None:
        # 该测试用于确认 Word docx 正文段落可按行导入。
        content = base64.b64encode(_build_docx_bytes(["评论A", "评论B"])).decode("ascii")
        result = parse_comment_import_payload({"file_name": "comments.docx", "content_base64": content, "split_mode": "line"})
        self.assertEqual([item["text"] for item in result["comments"]], ["评论A", "评论B"])

    def test_reject_csv_payload(self) -> None:
        # 该测试用于确认导入格式保持简单，不再扩展表格格式。
        content = base64.b64encode("评论A\n评论B".encode("utf-8")).decode("ascii")
        with self.assertRaisesRegex(RuntimeError, "当前只支持 txt 和 docx"):
            parse_comment_import_payload({"file_name": "comments.csv", "content_base64": content, "split_mode": "line"})

    def test_reject_old_doc_payload(self) -> None:
        # 该测试用于确认旧版 doc 不进入不稳定解析路径。
        content = base64.b64encode(b"legacy-doc").decode("ascii")
        with self.assertRaisesRegex(RuntimeError, "另存为 docx"):
            parse_comment_import_payload({"file_name": "comments.doc", "content_base64": content, "split_mode": "line"})


if __name__ == "__main__":
    unittest.main()
