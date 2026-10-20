# End-to-end test: three separate browser sessions (each its own "device" with its own anonymous sign-in) join one table
# on the local Firebase emulators, plus one computer player, and play until someone wins or time runs out.
# Needs: npx firebase-tools emulators:start --only auth,firestore,functions   (from the project folder)
# Run:   python3 tools/e2e.py docs <screenshot dir> [seconds]
import sys, os, time, threading, http.server, functools
from playwright.sync_api import sync_playwright

docs, out = sys.argv[1], sys.argv[2]
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 150
os.makedirs(out, exist_ok=True)
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=docs)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8779), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8779/index.html?emu=127.0.0.1'
NAMES = ['Abhyuday', 'Eric', 'Martin']
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
    pages = []
    for i, n in enumerate(NAMES):
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, n=n: errs.append(n + ': ' + str(e)))
        pg.on('console', lambda m, n=n: m.type == 'error' and errs.append(n + ': ' + m.text))
        pg.goto(BASE if i == 0 else BASE + '&t=' + code)
        pg.fill('#name', n)
        if i == 0:
            pg.click('#create')
            pg.wait_for_selector('#lobby:not([hidden])', timeout=30000)
            code = pg.inner_text('#lobby-code').strip()
            print('table', code)
        else:
            pg.click('#join')
            pg.wait_for_selector('#lobby:not([hidden])', timeout=30000)
        pages.append(pg)
    host = pages[0]
    host.click('#add-bot'); host.wait_for_timeout(800)
    host.screenshot(path=f'{out}/lobby.png', full_page=True)
    host.click('#start')
    for pg in pages: pg.wait_for_selector('#table:not([hidden])', timeout=30000)
    t0 = time.time(); over = False
    while time.time() - t0 < secs and not over:
        for i, pg in enumerate(pages):
            shots = set()
            try: r = drive(pg, lambda name: None)
            except Exception as e: r = None if 'not attached' in str(e) or 'Timeout' in str(e) else (_ for _ in ()).throw(e)
            if r: counts[r] = counts.get(r, 0) + 1
            if r == 'over': over = True
        time.sleep(0.25)
    time.sleep(2)
    for n, pg in zip(NAMES, pages): pg.screenshot(path=f'{out}/{n}.png')
    # Everyone should see the same public table.
    sig = [pg.inner_text('#opps') .count('₹') for pg in pages]
    phase = [pg.inner_text('#bar-sub') for pg in pages]
    print('moves', counts)
    print('bars', phase)
    print('over', over)
    print('errors', errs[:8] or 'none')
