import json, os, urllib.request

env = {}
with open(".env") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

url = f"{env['EXPO_PUBLIC_SUPABASE_URL']}/rest/v1/messages?select=created_at,role,content&order=created_at.desc&limit=12"
req = urllib.request.Request(url, headers={
    "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
    "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"]
})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    for r in data:
        print(f"\n{r['created_at']} [{r['role']}] ({r.get('persona')}):")
        print(f"  {r['content']}")
