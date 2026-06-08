import json

def convert_json_to_js(json_in, js_out):
    print(f"Reading JSON from {json_in}...")
    with open(json_in, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"Writing JS to {js_out}...")
    with open(js_out, 'w', encoding='utf-8') as f:
        f.write("// EPark Map Zones Data\n")
        f.write("window.zonesData = ")
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    
    print("Done!")

if __name__ == "__main__":
    import sys
    json_in = sys.argv[1] if len(sys.argv) > 1 else "epark_data.json"
    js_out = sys.argv[2] if len(sys.argv) > 2 else "zonesData.js"
    convert_json_to_js(json_in, js_out)
