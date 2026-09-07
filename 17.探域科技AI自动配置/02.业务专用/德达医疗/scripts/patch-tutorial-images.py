"""Explicitly approved deterministic edits; source PNGs are never overwritten."""
from pathlib import Path
import hashlib, json
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('D:/Pictures/使用教程')
OUT = ROOT / 'output/教程修订版-20260905'
# Rectangles are exclusive at right/bottom. Retain borders and factual notes.
SPECS = [
 ('C1', (533,98,870,146), (301,334,471,476),5),
 ('Y105Y106', None,(612,58,743,175),3),
 ('1A',(28,88,367,138),(653,286,942,372),6),
 ('1LW',(16,51,355,104),(400,517,602,658),6),
 ('1SW',(22,209,361,264),(473,468,769,552),6),
 ('2AW',(62,81,401,132),(458,541,675,654),6),
 ('A1',(24,129,363,183),(747,185,938,326),5),
 ('Q1Q2',(25,180,434,244),(427,20,717,106),6),
 ('Q3L',(608,65,918,119),(3,316,193,458),7),
 ('Q5L',(417,99,828,163),(27,586,254,700),7),
 ('Q10L',(7,364,317,416),(762,529,952,670),7),
 ('Y300W',(180,585,490,639),(308,397,531,511),7),
 ('Y5AW',(601,52,911,105),(534,541,742,655),7),
 ('Y5L',(563,343,872,395),(360,481,550,623),8),
 ('Y5W',(20,416,329,471),(198,553,388,695),7),
 ('MY-5C',None,(591,347,797,406),3),
 ('YS-8Y',None,(518,357,724,415),3),
]

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def paint(im, rect, text, preferred):
    x,y,r,b=rect
    d=ImageDraw.Draw(im)
    for size in range(preferred,12,-1):
        font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',size)
        lines=[]; line=''
        for ch in text:
            if line and d.textlength(line+ch,font=font)>r-x-10:
                lines.append(line); line=''
            line+=ch
        if line: lines.append(line)
        height=len(lines)*(size+6)
        if height <= b-y-6: break
    else: raise ValueError('Text does not fit '+text)
    d.rectangle((x,y,r-1,b-1),fill='white')
    for i,line in enumerate(lines):
        d.text((x+5,y+3+i*(size+6)),line,font=font,fill='black',anchor='lt')
    return dict(rect=rect,text=text,fontSize=size,lines=lines)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=[]; previews=[]
    for model,advice,step,n in SPECS:
        matches=[p for p in SOURCE.glob('*.png') if p.name.startswith(model+'使用') or (model in ['Y105Y106','MY-5C'] and p.name.startswith(model))]
        assert len(matches)==1,(model,matches)
        src=matches[0]; original_hash=digest(src)
        original=Image.open(src).convert('RGB'); edited=original.copy()
        patches=[]
        if advice: patches.append(paint(edited,advice,'吸氧档位及用氧要求请遵医嘱。',18))
        patches.append(paint(edited,step,f'{n}. 按医生确定的档位及用氧要求使用。',20))
        mask=Image.new('L',original.size,0); md=ImageDraw.Draw(mask)
        for p in patches:
            x,y,r,b=p['rect']; md.rectangle((x,y,r-1,b-1),fill=255)
        diff=ImageChops.difference(original,edited)
        outside=Image.composite(Image.new('RGB',original.size),diff,mask)
        assert outside.getbbox() is None
        target=OUT/src.name; edited.save(target)
        assert digest(src)==original_hash
        assert Image.open(target).size==original.size
        manifest.append(dict(model=model,source=str(src),file=str(target),sourceSha256=original_hash,sha256=digest(target),patches=patches,outsidePixelsUnchanged=True))
        tile=Image.new('RGB',(720,190),'#ddd'); td=ImageDraw.Draw(tile)
        td.text((5,3),model,font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18),fill='black')
        for i,p in enumerate(patches):
            crop=edited.crop(p['rect']); tile.paste(crop,(5+i*420,35))
        previews.append(tile)
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    for start in range(0,len(previews),6):
        sheet=Image.new('RGB',(720,190*len(previews[start:start+6])),'white')
        for row,tile in enumerate(previews[start:start+6]): sheet.paste(tile,(0,row*190))
        sheet.save(OUT/f'review-{start//6+1}.png')
    print(json.dumps(dict(images=len(manifest),outsidePixelChecks='all passed',output=str(OUT)),ensure_ascii=False))

if __name__=='__main__': main()
