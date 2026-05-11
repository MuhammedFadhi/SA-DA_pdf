import fitz
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

def analyze_pdf(path):
    doc = fitz.open(path)
    page = doc[0]
    text = page.get_text('dict')
    
    header_y = 0
    for b in text['blocks']:
        if b['type'] == 0:
            for l in b['lines']:
                for s in l['spans']:
                    if 'Method' in s['text']:
                        header_y = s['origin'][1]
    
    print(f"Header Y: {header_y}")
    
    items_below = []
    for b in text['blocks']:
        if b['type'] == 0:
            for l in b['lines']:
                for s in l['spans']:
                    if s['origin'][1] > header_y:
                        items_below.append({
                            'y': s['origin'][1],
                            'x': s['origin'][0],
                            'text': s['text']
                        })
    
    items_below.sort(key=lambda x: (x['y'], x['x']))
    
    for item in items_below:
        print(f"y={item['y']:6.1f} x={item['x']:6.1f} | {item['text']}")

if __name__ == "__main__":
    analyze_pdf(sys.argv[1])
