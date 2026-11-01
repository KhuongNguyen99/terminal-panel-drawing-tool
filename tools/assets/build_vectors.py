"""Regenerate the AQ and Ex-AI SVGs from checked-in reference crops."""

from pathlib import Path
from PIL import Image
from html import escape
root=Path(__file__).resolve().parents[2]
out=root/'dist/assets'

def rect(x,y,w,h,fill,stroke=None,sw=.6,rx=None):
 a=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"'
 if stroke:a+=f' stroke="{stroke}" stroke-width="{sw}"'
 if rx is not None:a+=f' rx="{rx}"'
 return a+'/>'
def path(d,fill='none',stroke=None,sw=.6):
 a=f'<path d="{d}" fill="{fill}"'
 if stroke:a+=f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"'
 return a+'/>'
def circle(x,y,r,fill,stroke=None,sw=.6):
 return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="{sw}"' if stroke else '')+'/>'
def ellipse(x,y,rx,ry,fill,stroke,sw=.6):
 return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def text(x,y,s,size,width=None,fill='#454545',anchor=None):
 return f'<text x="{x}" y="{y}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" fill="{fill}"'+(f' textLength="{width}" lengthAdjust="spacingAndGlyphs"' if width else '')+(f' text-anchor="{anchor}"' if anchor else '')+'>'+escape(s)+'</text>'
def led(x,y,w=4,h=4):return rect(x,y,w,h,'#ffffff','#939393',.45)
def preserved_pixels(filename, box):
 # Preserve the genuinely unreadable tiny factory marking exactly as colored
 # vector pixel runs. These are original pixels, not inferred letters.
 im=Image.open(out/filename).convert('RGBA'); x0,y0,x1,y1=box;parts=['<g aria-label="Original tiny factory marking, preserved without interpretation">']
 for y in range(y0,y1):
  x=x0
  while x<x1:
   rgba=im.getpixel((x,y));end=x+1
   while end<x1 and im.getpixel((end,y))==rgba:end+=1
   if rgba[3]:parts.append(rect(x,y,end-x,1,'#%02x%02x%02x'%rgba[:3]))
   x=end
 parts.append('</g>');return ''.join(parts)
def svg(w,h,parts,title):
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w*4}" height="{h*4}" viewBox="0 0 {w} {h}" role="img"><title>{escape(title)}</title>\n'+''.join(parts)+'\n</svg>\n'

# AQ: geometry measured in the 89 x 517 cropped supplied reference.
p=[]
# Left catches, molded tabs and base fingers, drawn behind the module face.
p+=[path('M4 30H19V102H4Z','#757575','#686868',.65),path('M0.7 267L13 258V266H19V279H0.7Z','#757575','#696969',.65)]
for y,h in [(380,15),(403,16),(430,16)]: p.append(rect(0,y,19,h,'#757575','#8d8d8d',.6))
# Main electronic housing and lower baseunit.
p+=[rect(19,5,68,310,'#757575','#5e5e5e',.6),rect(20,7,65,9.8,'#606060'),rect(20,10.3,65,1,'#434343'),rect(20,17,65,25,'#777777'),rect(20,42,65,9,'#858585'),path('M20 42H85M20 51H85',stroke='#5b5b5b',sw=.6),rect(20,51.4,65,257,'#757575'),rect(20,233,65,75,'#747474'),rect(19,309.5,68,7.8,'#353535')]
p+=[rect(45.5,.7,15.3,9.3,'#757575','#626262',.5),rect(50.2,0,4.3,1,'#555555'),rect(40.6,7.5,3.9,2,'#454545'),rect(61.9,7.5,3.7,2,'#454545')]
p+=[path('M24 63.5H82V77L79 80V191L82 194V207H24V194L27 191V80L24 77Z','#757575','#565656',.7),rect(24.1,63.6,57.8,6.6,'#626262','#565656',.5)]
p += [text(23.3,27,'AQ',9,11),text(23.3,38.5,'2xU/I',9,20.5),text(71.5,27,'HF',8.8,10),led(24,44.2),text(23.6,57.7,'DIAG',7.8,18)]
p += [led(24,215.7),text(29.8,220,'AQ0',6.7,11.1),led(42.1,215.7),text(47.7,220,'AQ1',6.7,11.1),led(24,224.1),text(29.8,228.4,'F0',6.7,7.2),led(42.1,224.1),text(47.7,228.4,'F1',6.7,7.2),rect(61.7,215.2,20.5,21.4,'#4b6eff','#666666',.7)]
p += [led(24,285.2),text(29.9,290.1,'PWR',7.4,14.5),text(67.7,290.1,'CC00',7.3,14.1),text(23.4,305.8,'6ES7135-6HB00-0CA1',7.1,60.1)]
p += [rect(19,317.6,68,198.5,'#757575','#626262',.65),path('M20 319H85M20 502.8H85',stroke='#616161',sw=.65)]
# All nine terminal pairs. Circle centers remain exactly aligned to the app geometry.
rows=[332,352,372,392,412,432,452,472,492]
for i,y in enumerate(rows):
 p += [ellipse(43,y,9.5,9.0,'#757575','#5b5b5b',.75),ellipse(63,y,9.5,9.0,'#757575','#5b5b5b',.75)]
 for x,outer in [(28,22.2),(78.5,84.1)]:
  p += [rect(x-4,y-8.5,8,17,'#626262','#505050',.65),rect(x-1.7,y-8.1,3.4,16.2,'#4a4a4a')]
  if 4<=i<=7:p += [rect(x-2.7,y-7.9,5.3,15.7,'#ffffff'),path(f'M{x-2.7} {y-7.9}V{y+7.8}',stroke='#d3d3d3',sw=.65)]
  if i==8:p += [rect(x-2.7,y-7.9,5.3,15.7,'#ff0000' if x<50 else '#0000ff'),rect(x-1.1,y-7.9,1.7,15.7,'#bf0000' if x<50 else '#0000bc')]
  p += [path(f'M{outer-2.2} {y-1.5}L{outer-.2} {y-3.5}L{outer+2} {y-1.6}V{y+1.6}L{outer-.2} {y+3.5}L{outer-2.2} {y+1.3}Z','#898989','#5d5d5d',.6)]
  p += [path(f'M{x-4.9} {y+6.8}V{y+8.7}H{x-1.5}M{x+4.9} {y+6.8}V{y+8.7}H{x+1.5}',stroke='#4c4c4c',sw=.8)]
 if i<8:p += [circle(53,y+10,2.25,'#757575','#606060',.7)]
p += [rect(45.6,317.2,15.2,8.5,'#757575','#636363',.65),path('M20 507H29V511H24V516M86 507H77V511H82V516',stroke='#5f5f5f',sw=.8)]
(out/'module-aq.svg').write_text(svg(89,517,p,'AQ 2xU/I HF — 6ES7135-6HB00-0CA1, supplied front view reconstructed as vector'),encoding='utf-8',newline='\n')

# Ex-AI: geometry measured in the 133 x 607 cropped supplied reference.
p=[]
p += [rect(9.2,46,18.8,82,'#757575','#5b5b5b',.8),path('M6 303L21 293V303H28V318H6Z','#757575','#666666',.75)]
for y,h in [(445,19),(472,20),(506,20)]:p.append(rect(0,y,28,h,'#757575','#555555',.8))
p += [path('M0 478H28M0 485H28',stroke='#555555',sw=.75)]
p += [rect(28,1,103,374.6,'#757575','#414141',.9),rect(29,1.7,101,7.4,'#616161'),rect(29,9.2,101,12.1,'#757575','#525252',.65),rect(29,20.4,101,8,'#585858'),path('M30 17.5H129',stroke='#404040',sw=2),rect(34,13,90,7.2,'#757575','#4e4e4e',.6),rect(73.5,9.1,18,12,'#787878','#666666',.55),rect(29,29,101,29.5,'#777777'),rect(29,58.5,101,9.5,'#8a8a8a'),path('M29 58.4H130M29 68.3H130',stroke='#555555',sw=.7),rect(29,69,101,298,'#757575'),rect(29,265,101,102,'#747474'),rect(29,368,101,8,'#353535')]
p.append(preserved_pixels('module-ex-ai.png',(62,3,101,8)))
p += [text(32.6,42,'Ex-AI',11.1,31),text(113,42,'HA',10.8,13),text(32.5,55.2,'2xI 2-wire HART',10.5,73.2),led(33.1,60.8,5.7,4.8),led(49.4,60.8,5.2,4.8),text(32.6,78.1,'DIAG MT',9,30)]
p += [path('M46.5 82.5H114V99.2L110 103V228L114 232V249.6H46.5V232L50.5 228V103L46.5 99.2Z','#757575','#545454',.7),rect(46.6,82.6,67.3,8.6,'#585858','#545454',.6)]
# The same printed two-wire / HART terminal legend, verified in manufacturer illustration.
p += [path('M68 142H60V181.4H68M93 142H100V181.4H93M68 184H60V222.5H68M93 184H100V222.5H93',stroke='#484848',sw=.85)]
p += [text(79.6,151.8,'AI 2-wire',8.7,31,anchor='middle'),text(79.6,190.7,'HART',8.3,22.8,anchor='middle')]
for y,left,right,nl,nr in [(164,'I0+','I1+',1,2),(175.6,'UV0','UV1',3,4),(204,'H0+','H1+',5,6),(215.8,'H0-','H1-',7,8)]:
 p += [text(53, y,str(nl),8.1,4.9),text(61.8,y,left,8.1,13.8),text(85.6,y,right,8.1,13.8),text(104.5,y,str(nr),8.1,4.9)]
p += [led(33.1,257.8,5.5,5.1),text(40,263,'AI0',8.4,10.5),led(53.8,257.8,5.5,5.1),text(60.3,263,'AI1',8.4,10.5),led(33.1,267.9,5.5,5.1),text(40,273.1,'F0',8.3,8.2),led(53.8,267.9,5.5,5.1),text(60.3,273.1,'F1',8.3,8.2),rect(103.2,257.8,22.6,22.2,'#ffffff','#999999',.8)]
p += [text(106.2,300.3,'X',10.5,6.8),text(119,300.3,'2',10.5,6),text(106.2,311,'3',10.5,6),text(119,311,'4',10.5,6),path('M114.5 292V312M105 301.8H126',stroke='#555555',sw=.7)]
p += [led(33.1,337,5.5,5),text(40,342.6,'PWR',8.6,16.6),text(105.5,342.4,'BU:X1',8.1,21),text(42.2,361.8,'6DL1134-6TB00-0HX1',9.6,75.3)]
# Blue Ex BaseUnit, exact two-column/four-row geometry of the reference.
p += [rect(28,376,103,230,'#0275af','#215578',.9),path('M30 378H49M110 378H128',stroke='#365360',sw=1.2),rect(73.4,376,18.1,13.8,'#757575','#616161',.7)]
for i,y in enumerate([433,459,485,511]):
 for x in [55,104]:
  p += [circle(x,y,9.8,'#0275af','#254553',.95),path(f'M{x-7.3} {y-7.2}H{x+6.7}V{y-2.5}M{x-8.8} {y-1.1}V{y+4.7}L{x-5.6} {y+7.9}M{x-2.9} {y+9}H{x+5.9}L{x+8.6} {y+5.8}V{y-4.5}',stroke='#1d4659',sw=.8),rect(x-4.1,y-7.3,8.1,14.5,'#0275af','#254553',.65)]
 for x,outer in [(37.9,30.2),(120.7,128.6)]:
  p += [path(f'M{x-3.4} {y-10.5}H{x+3.4}V{y-8.8}H{x+5}V{y+9.3}H{x+3.4}V{y+11.1}H{x-3.4}V{y+9.3}H{x-5}V{y-8.8}H{x-3.4}Z','#737b7e','#254553',.7),rect(x-3.9,y-8.6,7.8,18,'#ffffff','#424949',.8),rect(x-2.3,y-8.2,1.2,17.2,'#d4d9dc'),rect(x+2.2,y-8.2,1.2,17.2,'#b4c4ca'),path(f'M{outer} {y-3.5}L{outer+(-2.5 if x<80 else 2.5)} {y-1.5}V{y+2.2}L{outer} {y+4}',stroke='#264c5e',sw=.9)]
 p += [circle(79.8,y+.4,2.7,'#3c753c','#364936',.65)]
 # Visible contact numbers preserved in the same outside positions.
 p += [text(29.2,y+10.6,str(2*i+1),5.1,2.7,fill='#294f65'),text(128.2,y+10.6,str(2*i+2),5.1,2.7,fill='#294f65')]
p += [path('M58.8 537H65.5V558H58.8M99.2 537H92.5V558H99.2M58.8 562H65.5V583H58.8M99.2 562H92.5V583H99.2',stroke='#315263',sw=.9)]
for x,y,num in [(53.3,544.8,1),(53.3,555,3),(100.1,544.8,2),(100.1,555,4),(53.3,570.1,5),(53.3,580.3,7),(100.1,570.1,6),(100.1,580.3,8)]:p.append(text(x,y,str(num),8.1,4.8,fill='#315263'))
p += [path('M28.8 594H40V599H33.7V605M130.3 594H119V599H125.3V605M60.6 606V594H98.7V606M65.7 594V590H71.3V594M76.5 594V590H82.5V594M89.2 594V590H94.5V594M69.7 595.5V603H76.5V595.5M83.7 595.5V603H90.7V595.5',stroke='#305569',sw=.9)]
(out/'module-ex-ai.svg').write_text(svg(133,607,p,'Ex-AI 2xI 2-wire HART — 6DL1134-6TB00-0HX1, supplied front view reconstructed as vector'),encoding='utf-8',newline='\n')
print('Wrote',out/'module-aq.svg',out/'module-ex-ai.svg')
