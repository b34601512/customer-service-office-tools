from pathlib import Path
import json, hashlib
from PIL import Image, ImageDraw, ImageChops

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/教程去二维码-20260905'
T=ROOT/'output/教程修订版-20260905'
F=Path('D:/Pictures/1.过滤器更换教程')
SPECS=[
 ('2AW',T/'2AW使用方法操作图解使用教程.png', [[(430,487),(556,487),(579,537),(455,537),(455,617),(445,609)]], [(247,475,504,514),(454,537,679,659)], [[(477,411),(485,411),(590,539),(580,539)]]),
 ('Q1Q2',T/'Q1Q2使用方法操作图示使用教程.png', [[(888,340),(978,340),(978,432),(888,432)],[(890,432),(949,432),(949,457),(890,457)],[(244,531),(266,531),(266,553),(244,553)],[(223,553),(267,553),(267,565),(223,565)]],[],[]),
 ('Y5AW',T/'Y5AW使用方法操作图解使用教程.png', [[(858,364),(896,364),(896,390),(858,390)],[(826,393),(895,393),(895,408),(826,408)]],[],[]),
 ('Y5L',T/'Y5L使用方法使用教程使用教程.png', [[(868,216),(893,209),(896,333),(879,338),(868,301)]],[(556,302,879,467)],[]),
 ('1LW-filter',F/'1LW过滤器更换图.png', [[(0,171),(35,171),(35,215),(0,215)]],[],[]),
 ('Q10-filter',F/'Q10过滤器更换图示.png', [[(69,389),(99,400),(108,494),(78,480)]],[],[]),
 ('Q5L-filter',F/'Q5L二级过滤位置.png', [[(25,150),(75,157),(77,201),(29,194)]],[],[]),
]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 OUT.mkdir(parents=True,exist_ok=True); manifest=[]
 for model,src,polys,rects,protected in SPECS:
  h=sha(src); before=Image.open(src).convert('RGB'); mask=Image.new('L',before.size); d=ImageDraw.Draw(mask)
  for poly in polys:d.polygon(poly,fill=255)
  for r in rects:d.rectangle(r,fill=0)
  for poly in protected:d.polygon(poly,fill=0)
  after=Image.composite(Image.new('RGB',before.size,'#d6d6d6'),before,mask)
  diff=ImageChops.difference(before,after)
  assert Image.composite(Image.new('RGB',before.size),diff,mask).getbbox() is None
  dest=OUT/src.name; after.save(dest); assert sha(src)==h
  manifest.append(dict(model=model,source=str(src),sourceSha256=h,file=str(dest),sha256=sha(dest),polygons=polys,protectedRects=rects,protectedPolygons=protected,outsidePixelsUnchanged=True))
 (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
 print('7 images saved; source hashes and outside pixels unchanged')
if __name__=='__main__':main()
