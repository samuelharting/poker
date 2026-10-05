import sys, glob, os
from PIL import Image
d = sys.argv[1]; out = sys.argv[2]
files = sorted(glob.glob(os.path.join(d, '*.png')))
ims = [Image.open(f).convert('RGB') for f in files]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 2
w, h = ims[0].size
s = 0.6
tw, th = int(w*s), int(h*s)
rows = (len(ims)+cols-1)//cols
sheet = Image.new('RGB', (tw*cols, th*rows))
for i, im in enumerate(ims):
    sheet.paste(im.resize((tw, th)), ((i%cols)*tw, (i//cols)*th))
sheet.save(out)
print(files)
