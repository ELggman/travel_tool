#!/usr/bin/env python3
"""Cross-check local route geometries against OSRM and flag detours/deviations."""
import csv, json, math, os, time, urllib.parse, urllib.request
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.join(ROOT,'spikes','out')
CACHE=os.path.join(OUT,'osrm-geometries')
os.makedirs(CACHE,exist_ok=True)
UA='yanlu-spike/0.1 (contact: egglhl6@gmail.com)'
R=6371000.0

def hav(lon1,lat1,lon2,lat2):
    p1,p2=math.radians(lat1),math.radians(lat2)
    dp=math.radians(lat2-lat1); dl=math.radians(lon2-lon1)
    a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def nearest(p,line):
    # local equirectangular projection around p; fast enough for a city
    lat0=math.radians(p[1]); kx=111320.0*math.cos(lat0); ky=110540.0
    px,py=(p[0]-p[0])*kx,(p[1]-p[1])*ky
    best=1e18
    for a,b in zip(line,line[1:]):
        ax,ay=(a[0]-p[0])*kx,(a[1]-p[1])*ky
        bx,by=(b[0]-p[0])*kx,(b[1]-p[1])*ky
        dx,dy=bx-ax,by-ay
        if dx==0 and dy==0:
            d=ax*ax+ay*ay
        else:
            t=max(0.0,min(1.0,-(ax*dx+ay*dy)/(dx*dx+dy*dy)))
            qx,qy=ax+t*dx,ay+t*dy
            d=qx*qx+qy*qy
        if d<best: best=d
    return math.sqrt(best)

def osrm_geom(city,route):
    cache=os.path.join(CACHE,f"{city}-{route['id']}.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    profile='foot' if route['mode']=='walk' else 'car'
    coord=f"{route['start'][0]},{route['start'][1]};{route['end'][0]},{route['end'][1]}"
    url=f"https://routing.openstreetmap.de/routed-{profile}/route/v1/{profile}/{coord}?overview=full&geometries=geojson&steps=false"
    req=urllib.request.Request(url,headers={'User-Agent':UA})
    with urllib.request.urlopen(req,timeout=30) as resp:
        d=json.load(resp)
    if d.get('code')!='Ok': raise RuntimeError(d.get('code'))
    data={'route':d['routes'][0],'fetched':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
    json.dump(data,open(cache,'w'),ensure_ascii=False)
    return data

def main():
    rows=[]; report={}
    for city in ['chongqing','wuhan','guiyang']:
        data=json.load(open(os.path.join(ROOT,'spikes','web','data',f'{city}.json')))
        route_geo={f['properties']['id']:f for f in data['geojson']['features']}
        items=[]
        for r in data['summary']['routes']:
            if not r.get('ok'): continue
            local=route_geo[r['id']]['geometry']['coordinates']
            osrm=osrm_geom(city,r)['route']
            oline=osrm['geometry']['coordinates']
            # sample local points (cap at 80) and OSRM points (cap at 80)
            def sample(line,n=80):
                if len(line)<=n: return line
                step=max(1,len(line)//n)
                s=line[::step]
                if s[-1]!=line[-1]: s.append(line[-1])
                return s
            dev_local=max(nearest(p,oline) for p in sample(local))
            dev_osrm=max(nearest(p,local) for p in sample(oline))
            straight=hav(r['start'][0],r['start'][1],r['end'][0],r['end'][1])
            delta=r['distanceM']-round(osrm['distance'])
            pct=delta/round(osrm['distance'])*100 if osrm['distance'] else 0
            max_dev=max(dev_local,dev_osrm)
            flag=abs(pct)>10 or max_dev>300
            item={
                'id':r['id'],'mode':r['mode'],'from':r['from'],'to':r['to'],
                'local_m':r['distanceM'],'osrm_m':round(osrm['distance']),
                'delta_m':delta,'delta_pct':round(pct,1),
                'local_min':r['durationMin'],'osrm_min':round(osrm['duration']/60,1),
                'max_deviation_m':round(max_dev),'straight_m':round(straight),
                'local_detour_ratio':round(r['distanceM']/max(straight,1),2),
                'osrm_detour_ratio':round(osrm['distance']/max(straight,1),2),
                'review':bool(flag),
            }
            items.append(item); rows.append([city,item])
            print(f"{city:9} {r['id']:13} {item['local_m']:6} / {item['osrm_m']:6} m  {item['delta_pct']:+6.1f}%  dev {max_dev:6.0f} m  {'REVIEW' if flag else 'ok'}")
        report[city]=items
    json.dump(report,open(os.path.join(OUT,'route-review.json'),'w'),ensure_ascii=False,indent=2)
    with open(os.path.join(OUT,'route-review.csv'),'w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['city','id','mode','from','to','local_m','osrm_m','delta_m','delta_pct','local_min','osrm_min','max_deviation_m','straight_m','local_detour_ratio','osrm_detour_ratio','review'])
        for city,it in rows:
            w.writerow([city,it['id'],it['mode'],it['from'],it['to'],it['local_m'],it['osrm_m'],it['delta_m'],it['delta_pct'],it['local_min'],it['osrm_min'],it['max_deviation_m'],it['straight_m'],it['local_detour_ratio'],it['osrm_detour_ratio'],it['review']])
    print('review rows',len(rows),'flagged',sum(1 for _,it in rows if it['review']))

if __name__=='__main__':
    main()
