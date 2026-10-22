#!/usr/bin/env python3
"""Combine route summary, GeoJSON, OSRM baseline and city metadata for preview.html."""
import json, os
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.join(ROOT,'spikes','out')
WEB=os.path.join(ROOT,'spikes','web','data')
CITIES={'chongqing':{'name':'重庆','pack':'chongqing-core-z15.pmtiles'},
        'wuhan':{'name':'武汉','pack':'wuhan-core-z15.pmtiles'},
        'guiyang':{'name':'贵阳','pack':'guiyang-core-z15.pmtiles'}}
for city,meta in CITIES.items():
    summary=json.load(open(os.path.join(OUT,f'{city}-routes.json')))
    geo=json.load(open(os.path.join(OUT,f'{city}-routes.geojson')))
    osrm={r['id']:r for r in json.load(open(os.path.join(OUT,f'{city}-osrm.json')))['rows']}
    for r in summary['routes']:
        o=osrm.get(r['id'],{})
        r['osrm']=o if o.get('osrm_ok') else None
    pts=[p for r in summary['routes'] for p in [r.get('start'),r.get('end')] if p]
    center=[sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)] if pts else [0,0]
    data={'city':city,'name':meta['name'],'pack':meta['pack'],'center':center,'zoom':11.5,'summary':summary,'geojson':geo}
    json.dump(data,open(os.path.join(WEB,f'{city}.json'),'w'),ensure_ascii=False,separators=(',',':'))
    print(city,'written')
