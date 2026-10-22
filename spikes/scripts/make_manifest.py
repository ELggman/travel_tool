#!/usr/bin/env python3
import hashlib, json, os, time
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA=os.path.join(ROOT,'spikes','data')
MAP=os.path.join(ROOT,'spikes','map')
OUT=os.path.join(ROOT,'spikes','web','data','packs.json')
CITIES={
 'chongqing':{'name':'重庆','bbox':[106.42,29.49,106.65,29.63],'pack':'chongqing-core-z15.pmtiles'},
 'wuhan':{'name':'武汉','bbox':[114.22,30.47,114.45,30.65],'pack':'wuhan-core-z15.pmtiles'},
 'guiyang':{'name':'贵阳','bbox':[106.55,26.30,106.76,26.66],'pack':'guiyang-core-z15.pmtiles'},
}
def info(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return {'sizeBytes':os.path.getsize(path),'sha256':h.hexdigest()}
out={'schemaVersion':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'attribution':'© OpenStreetMap contributors · Protomaps · ODbL','cities':[]}
for cid,meta in CITIES.items():
    pack=os.path.join(MAP,meta['pack'])
    entry={'id':cid,'name':meta['name'],'bbox':meta['bbox'],'packFile':meta['pack'],'downloadPath':'packs/%s/%s'%(cid,meta['pack'])}
    entry.update(info(pack))
    entry['graphs']={}
    for mode in ['walk','car']:
        p=os.path.join(DATA,f'{cid}-{mode}.json')
        entry['graphs'][mode]={'file':os.path.basename(p),'sizeBytes':os.path.getsize(p)}
    out['cities'].append(entry)
    print(cid, entry['sizeBytes'], entry['sha256'][:16], 'graphs', {k:v['sizeBytes'] for k,v in entry['graphs'].items()})
json.dump(out,open(OUT,'w'),ensure_ascii=False,indent=2)
print('wrote',OUT)
