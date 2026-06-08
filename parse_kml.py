import xml.etree.ElementTree as ET
import json
import re

def parse_kml(kml_path, json_out_path):
    # Register namespaces to handle KML namespace
    namespace = {'kml': 'http://www.opengis.net/kml/2.2'}
    
    print(f"Parsing KML file: {kml_path}...")
    try:
        tree = ET.parse(kml_path)
        root = tree.getroot()
    except Exception as e:
        print(f"Error parsing KML: {e}")
        return

    # Find all Folders
    folders = root.findall('.//kml:Folder', namespace)
    print(f"Found {len(folders)} folders in KML.")
    
    all_data = {}
    
    for folder in folders:
        folder_name_el = folder.find('kml:name', namespace)
        folder_name = folder_name_el.text if folder_name_el is not None else "Unnamed Folder"
        print(f"Processing folder: {folder_name}")
        
        placemarks_data = []
        placemarks = folder.findall('.//kml:Placemark', namespace)
        print(f"  Found {len(placemarks)} placemarks.")
        
        for pm in placemarks:
            name_el = pm.find('kml:name', namespace)
            name = name_el.text.strip() if name_el is not None else "Unnamed"
            
            desc_el = pm.find('kml:description', namespace)
            desc = desc_el.text.strip() if desc_el is not None else ""
            
            # Try to parse some info from description (like rate, stalls, hours)
            stalls = None
            rate = None
            hours = None
            max_hours = None
            
            if desc:
                # Extract stalls (e.g., "18 Stalls", "23 Stalls")
                stalls_match = re.search(r'(\d+)\s+Stalls', desc, re.IGNORECASE)
                if stalls_match:
                    stalls = int(stalls_match.group(1))
                
                # Extract rate (e.g., "Rate: $2.00 / HR")
                rate_match = re.search(r'Rate:\s*\$?([\d\.]+)', desc, re.IGNORECASE)
                if rate_match:
                    rate = f"${rate_match.group(1)}/HR"
                
                # Extract max hours (e.g., "2 Hours Max")
                max_match = re.search(r'(\d+)\s+Hours?\s+Max', desc, re.IGNORECASE)
                if max_match:
                    max_hours = f"{max_match.group(1)}h max"
            
            # Geometries
            geometry = None
            
            # 1. Polygon
            poly_el = pm.find('.//kml:Polygon', namespace)
            if poly_el is not None:
                coords_el = poly_el.find('.//kml:coordinates', namespace)
                if coords_el is not None and coords_el.text:
                    coords_text = coords_el.text.strip()
                    # Parse coords: "lng,lat,alt lng,lat,alt ..."
                    coords = []
                    for pt in coords_text.split():
                        parts = pt.split(',')
                        if len(parts) >= 2:
                            # Convert to float [lat, lng] for Leaflet
                            coords.append([float(parts[1]), float(parts[0])])
                    geometry = {
                        "type": "Polygon",
                        "coordinates": coords
                    }
            
            # 2. LineString (if polygon is missing, sometimes they are lines)
            if geometry is None:
                line_el = pm.find('.//kml:LineString', namespace)
                if line_el is not None:
                    coords_el = line_el.find('.//kml:coordinates', namespace)
                    if coords_el is not None and coords_el.text:
                        coords_text = coords_el.text.strip()
                        coords = []
                        for pt in coords_text.split():
                            parts = pt.split(',')
                            if len(parts) >= 2:
                                coords.append([float(parts[1]), float(parts[0])])
                        geometry = {
                            "type": "LineString",
                            "coordinates": coords
                        }
            
            # 3. Point (fallback or specific markers)
            if geometry is None:
                point_el = pm.find('.//kml:Point', namespace)
                if point_el is not None:
                    coords_el = point_el.find('kml:coordinates', namespace)
                    if coords_el is not None and coords_el.text:
                        parts = coords_el.text.strip().split(',')
                        if len(parts) >= 2:
                            geometry = {
                                "type": "Point",
                                "coordinates": [float(parts[1]), float(parts[0])]
                            }
            
            if geometry:
                placemarks_data.append({
                    "name": name,
                    "description": desc,
                    "stalls": stalls,
                    "rate": rate,
                    "maxHours": max_hours,
                    "geometry": geometry
                })
        
        all_data[folder_name] = placemarks_data

    with open(json_out_path, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, indent=2, ensure_ascii=False)
    
    print(f"Successfully wrote parsed map data to {json_out_path}")

if __name__ == "__main__":
    import sys
    kml = sys.argv[1] if len(sys.argv) > 1 else "epark_map.kml"
    json_out = sys.argv[2] if len(sys.argv) > 2 else "epark_data.json"
    parse_kml(kml, json_out)
