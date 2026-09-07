"""通用图片定点编辑器。

用途：按JSON配置做确定性遮盖或文字替换；永不覆盖源文件；校验修改区域外像素不变。
依赖：Pillow。
"""
from __future__ import annotations
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw, ImageFont, ImageChops


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_font(font_path: str | None, size: int):
    if font_path:
        return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def text_patch(image, rect, text, font_path=None, preferred_size=20, fill='black', background='white'):
    x, y, r, b = map(int, rect)
    draw = ImageDraw.Draw(image)
    chosen = None
    for size in range(int(preferred_size), 9, -1):
        font = load_font(font_path, size)
        lines, line = [], ''
        for ch in text:
            test = line + ch
            width = draw.textbbox((0, 0), test, font=font)[2]
            if line and width > (r - x - 10):
                lines.append(line)
                line = ch
            else:
                line = test
        if line:
            lines.append(line)
        line_h = size + 6
        if len(lines) * line_h <= (b - y - 6):
            chosen = (font, lines, line_h, size)
            break
    if not chosen:
        raise ValueError(f'文字无法放入区域: {rect}')
    font, lines, line_h, size = chosen
    draw.rectangle((x, y, r - 1, b - 1), fill=background)
    for i, line in enumerate(lines):
        draw.text((x + 5, y + 3 + i * line_h), line, font=font, fill=fill)
    return {'type': 'text', 'rect': rect, 'text': text, 'fontSize': size, 'lines': lines}


def mask_patch(image, job, mask):
    draw_mask = ImageDraw.Draw(mask)
    for poly in job.get('polygons', []):
        draw_mask.polygon([tuple(p) for p in poly], fill=255)
    for rect in job.get('rectangles', []):
        draw_mask.rectangle(tuple(rect), fill=255)
    for rect in job.get('protectedRects', []):
        draw_mask.rectangle(tuple(rect), fill=0)
    for poly in job.get('protectedPolygons', []):
        draw_mask.polygon([tuple(p) for p in poly], fill=0)
    fill = job.get('fill', '#d6d6d6')
    return Image.composite(Image.new('RGB', image.size, fill), image, mask)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()

    task_path = Path(args.task)
    output_dir = Path(args.output_dir)
    task = json.loads(task_path.read_text(encoding='utf-8'))
    jobs = task.get('jobs') or []
    if not jobs:
        raise ValueError('任务文件缺少 jobs')
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = []

    for index, job in enumerate(jobs, 1):
        source = Path(job['source'])
        if not source.exists():
            raise FileNotFoundError(source)
        source_hash = digest(source)
        expected_hash = job.get('sourceSha256')
        if expected_hash and source_hash != expected_hash:
            raise ValueError(f'源文件SHA不匹配: {source}')

        original = Image.open(source).convert('RGB')
        edited = original.copy()
        changed_mask = Image.new('L', original.size, 0)
        patches = []

        for edit in job.get('edits', []):
            kind = edit.get('type')
            if kind == 'mask':
                local_mask = Image.new('L', original.size, 0)
                edited = mask_patch(edited, edit, local_mask)
                changed_mask = ImageChops.lighter(changed_mask, local_mask)
                patches.append({'type': 'mask', **{k: v for k, v in edit.items() if k != 'type'}})
            elif kind == 'text':
                rect = edit['rect']
                x, y, r, b = map(int, rect)
                ImageDraw.Draw(changed_mask).rectangle((x, y, r - 1, b - 1), fill=255)
                patches.append(text_patch(
                    edited, rect, edit['text'], edit.get('fontPath'),
                    int(edit.get('preferredSize', 20)), edit.get('fill', 'black'), edit.get('background', 'white')
                ))
            else:
                raise ValueError(f'未知编辑类型: {kind}')

        diff = ImageChops.difference(original, edited)
        outside = Image.composite(Image.new('RGB', original.size), diff, changed_mask)
        if outside.getbbox() is not None:
            raise AssertionError(f'修改区域外像素发生变化: {source}')

        output_name = job.get('output') or source.name
        dest = output_dir / output_name
        if dest.resolve() == source.resolve():
            raise ValueError('禁止覆盖源文件')
        edited.save(dest)
        if digest(source) != source_hash:
            raise AssertionError(f'源文件被改动: {source}')
        if Image.open(dest).size != original.size:
            raise AssertionError(f'图片尺寸变化: {dest}')

        manifest.append({
            'index': index,
            'label': job.get('label'),
            'source': str(source),
            'sourceSha256': source_hash,
            'file': str(dest),
            'sha256': digest(dest),
            'patches': patches,
            'outsidePixelsUnchanged': True,
        })

    manifest_path = output_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'images': len(manifest), 'manifest': str(manifest_path)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
