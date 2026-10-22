#!/usr/bin/env python3
import json, os, time, urllib.request, urllib.parse
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.join(ROOT,'spikes','out')
UA='yanlu-spike/0.1 (contact: egglhl6@gmail.com)'
for city in ['chongqing','wuhan','guiyang']:
    summary=json.load(open(os.path.join(OUT,f'{city}-routes.json')))
    rows=[]
    for r in summary['routes']:
        if not r.get('ok'): rows.append({**r,'osrm_ok':False}); continue
        start=r['start']; end=r['end']
        profile='foot' if r['mode']=='walk' else 'car'
        base=f'https://routing.openstreetmap.de/routed-{profile}/route/v1/{profile}/'
        url=base+f"{start[0]},{start[1]};{end[0]},{end[1]}?overview=false&steps=false"
        req=urllib.request.Request(url,headers={'User-Agent':UA})
        try:
            with urllib.request.urlopen(req,timeout=30) as resp:
                data=json.load(resp)
            rt=data['routes'][0]
            rows.append({**r,'osrm_ok':True,'osrmDistanceM':round(rt['distance']),'osrmDurationMin':round(rt['duration']/60,1)})
            print(city,r['id'],r['mode'],'local',r['distanceM'],'osrm',round(rt['distance']),'delta',round(r['distanceM']-rt['distance']))
        except Exception as e:
            rows.append({**r,'osrm_ok':False,'osrm_error':str(e)[:200]})
            print(city,r['id'],'OSRM FAIL',e)
        time.sleep(0.35)
    json.dump({'city':city,'rows':rows},open(os.path.join(OUT,f'{city}-osrm.json'),'w'),ensure_ascii=False,indent=2)
