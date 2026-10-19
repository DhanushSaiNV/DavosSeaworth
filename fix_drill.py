#!/usr/bin/env python3
# -*- coding: utf-8 -*-

with open(r'C:\dev\DavosSeaworth\scripts\verify-fp05-drill.py', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''#!/usr/bin/env python3
"""FP-05 Integrated Drill — End-to-end verification of the evening journal chain (Steps 1-8).'''

new = '''#!/usr/bin/env python3
"""FP-05 Integrated Drill — End-to-end verification of the evening journal chain (Steps 1-8).

import asyncio'''

if old in content:
    content = content.replace(old, new)
    with open(r'C:\dev\DavosSeaworth\scripts\verify-fp05-drill.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Not found')