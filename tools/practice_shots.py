# Plays a practice game (you plus computer players) in a real browser and saves screenshots.
# python3 tools/practice_shots.py docs <out dir> <computer players> [seconds]
import sys, os, time, threading, http.server, functools
from playwright.sync_api import sync_playwright
docs, out, bots = sys.argv[1], sys.argv[2], sys.argv[3]
secs = float(sys.argv[4]) if len(sys.argv) > 4 else 90
os.makedirs(out, exist_ok=True)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=docs); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8782), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
errs = []
counts = {}

def drive(pg, snap):
    """One step of a simple human: answer whatever is asked, else play the first useful card, else end turn."""
    vis = lambda s: pg.is_visible(s)
    en = lambda s: pg.query_selector(f'{s}:not([disabled])')
    if vis('#sheet'):
        if en('[data-m="rematch"]'): snap('over'); return 'over'
        if en('[data-r="auto"]') or en('[data-r="payall"]'):
            snap('pay')
            (en('[data-r="auto"]') or en('[data-r="payall"]')).click(); pg.wait_for_timeout(80)
            if en('[data-r="pay"]'): en('[data-r="pay"]').click(); return 'pay'
        if en('[data-r="accept"]'): snap('respond'); en('[data-r="accept"]').click(); return 'accept'
        if en('[data-disc]'):
            snap('discard')
            n = int(pg.inner_text('#sheet h2').split()[-1])
            for el in pg.query_selector_all('[data-disc]:not(.sel)')[:max(0, n - len(pg.query_selector_all('[data-disc].sel')))]: el.click(); pg.wait_for_timeout(40)
            if en('#do-discard'): en('#do-discard').click(); return 'discard'
        # play sheet: pick choices in order, then go / prop / bank
        if not en('#sheet [data-f="go"]'):
            if en('#sheet [data-f="prop"]'): snap('play-prop'); en('#sheet [data-f="prop"]').click(); return 'choose'
            for key in ['color', 'set', 'target']:
                if pg.query_selector(f'#sheet [data-f="{key}"]') and not pg.query_selector(f'#sheet [data-f="{key}"].on'):
                    el = en(f'#sheet [data-f="{key}"]')
                    if el: snap('play-' + key); el.click(); pg.wait_for_timeout(60); return 'choose'
            for key in ['data-pickmine', 'data-pick']:
                if pg.query_selector(f'#sheet [{key}]') and not pg.query_selector(f'#sheet .card.sel[{key}]'):
                    snap('pick'); pg.query_selector(f'#sheet [{key}]').click(); pg.wait_for_timeout(60); return 'choose'
        if en('#sheet [data-f="go"]'): snap('play-go'); en('#sheet [data-f="go"]').click(); return 'go'
        if en('#sheet [data-f="bank"]'): en('#sheet [data-f="bank"]').click(); return 'bank'
        if en('[data-close]'): en('[data-close]').click(); return 'close'
        return None
    if en('#end'):
        hint = pg.inner_text('#hand-head')
        cards = pg.query_selector_all('#hand:not(.idle) [data-card]')
        if cards and '0 plays' not in hint:
            i = counts.get('tries', 0) % len(cards)
            counts['tries'] = counts.get('tries', 0) + 1
            if counts['tries'] % 7 == 6: en('#end').click(); return 'end'
            cards[i].click(); return 'card'
        en('#end').click(); return 'end'
    return None

with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in [('phone', {'width': 390, 'height': 844}), ('desk', {'width': 1300, 'height': 860})]:
        pg = b.new_page(viewport=vp, device_scale_factor=2 if tag == 'phone' else 1)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.goto('http://127.0.0.1:8782/index.html')
        pg.screenshot(path=f'{out}/{tag}-home.png')
        pg.fill('#name', 'Abhyuday'); pg.select_option('#bots', bots); pg.click('#practice')
        pg.wait_for_selector('#lobby:not([hidden])')
        pg.screenshot(path=f'{out}/{tag}-lobby.png', full_page=True)
        pg.click('#start')
        pg.wait_for_selector('#table:not([hidden])')
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{out}/{tag}-start.png')
        shots = set(); t0 = time.time()
        def snap(name):
            if name not in shots:
                shots.add(name); pg.wait_for_timeout(200); pg.screenshot(path=f'{out}/{tag}-{name}.png')
        mid = False
        while time.time() - t0 < secs:
            r = drive(pg, snap)
            if r: counts[r] = counts.get(r, 0) + 1
            if r == 'over': break
            if not mid and time.time() - t0 > secs / 2: mid = True; pg.screenshot(path=f'{out}/{tag}-mid.png'); pg.screenshot(path=f'{out}/{tag}-mid-full.png', full_page=True)
            pg.wait_for_timeout(120)
        pg.screenshot(path=f'{out}/{tag}-late.png')
        pg.close()
    b.close()
print('moves', counts)
print('errors', errs[:8] or 'none')
