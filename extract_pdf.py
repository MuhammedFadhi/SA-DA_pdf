import fitz
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

def extract_pdf_full(path):
    doc = fitz.open(path)
    result = []
    for i, page in enumerate(doc):
        blocks = []
        text = page.get_text('dict')
        for b in text['blocks']:
            if b['type'] == 0:
                for line in b['lines']:
                    for span in line['spans']:
                        blocks.append({
                            'y': round(span['origin'][1], 1),
                            'x': round(span['origin'][0], 1),
                            'size': round(span['size'], 1),
                            'text': span['text'],
                            'font': span['font']
                        })
        result.append(blocks)
    return result

print("=== 8473.pdf ===")
data = extract_pdf_full(r'c:\Users\lenovo\Desktop\New folder (9)\8473.pdf')
for b in data[0]:
    print(f"y={b['y']:6.1f} x={b['x']:6.1f} size={b['size']} | {b['text']}")

print("\n\n=== 8477.pdf ===")
data2 = extract_pdf_full(r'c:\Users\lenovo\Desktop\New folder (9)\8477.pdf')
for b in data2[0]:
    print(f"y={b['y']:6.1f} x={b['x']:6.1f} size={b['size']} | {b['text']}")

print("\n\n=== sada final.pdf ===")
data3 = extract_pdf_full(r'c:\Users\lenovo\Desktop\New folder (9)\sada final.pdf')
for b in data3[0]:
    print(f"y={b['y']:6.1f} x={b['x']:6.1f} size={b['size']} | {b['text']}")
