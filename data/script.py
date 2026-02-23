import json

with open('places_updated.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for item in data:
    # 1. توحيد حقل الصورة
    if 'Main Image URL' in item and 'image' not in item:
        item['image'] = item['Main Image URL']
    
    # 2. توحيد نوع التقييم (تحويله لرقم)
    if 'averageRating' in item:
        item['averageRating'] = float(item['averageRating'])
    
    # 3. بناء كائن GeoJSON للأماكن اللي فيها Coordinates
    if item.get('Coordinates') and ',' in item['Coordinates']:
        try:
            lat, lng = map(float, item['Coordinates'].split(','))
            item['location'] = {
                "type": "Point",
                "coordinates": [lng, lat] # الترتيب العالمي: Longitude ثم Latitude
            }
        except:
            pass

with open('places_final.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("✅ تم توحيد الهيكل بنجاح!")