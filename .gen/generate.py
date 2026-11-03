import json, os, re, subprocess, sys, time, base64, unicodedata

KEY = open('/home/sandbox/.secrets/elevenlabs_api_key').read().strip()
VOICE = 'Xb7hH8MSUJpSbSDYk0k2'  # Alice - Clear, Engaging Educator (premade, approved)
OUT = '/home/sandbox/mia-english/.gen/clips'
os.makedirs(OUT, exist_ok=True)

MIA = 'מִיָּה'
SHARED = {
 'he/intro3': 'מוכנה? בואי נתחיל!',
 'he/ineng': 'באנגלית אומרים:',
 'he/yourturn': 'גם את אמרי בקול!',
 'he/g1intro1': 'וואו, למדת חמש מילים חדשות!',
 'he/where': 'איפה ה',
 'he/wrong': 'אופסי, זה לא זה. נסי שוב!',
 'he/recap': 'בואי נזכור מה למדנו היום!',
 'he/praise1': f'כל הכבוד {MIA}!',
 'he/praise2': 'מעולה!',
 'he/praise3': 'וואו, יופי!',
 'he/praise4': 'את אלופה!',
 'he/praise5': 'נהדר!',
 'he/finale1': f'כל הכבוד {MIA}! סיימת שיעור שלם באנגלית!',
 'he/finale2': 'למדת היום חמש מילים חדשות באנגלית!',
 'he/finale3': 'את אלופת אנגלית! נתראה בשיעור הבא! ביי ביי!',
}
L1 = {
 'he/intro1': f'היי {MIA}! שְׂמֵחָה לראות אותך!',
 'he/intro2': 'אני לֵילִי הינשוף, והיום נלמד חיות באנגלית!',
 'he/move_bird': 'קומי קומי! תפרפרי עם הידיים כמו ציפור!',
 'he/move_rabbit': 'קומי קומי! תקפצי כמו ארנב! קפוץ קפוץ!',
 'he/g1intro2': 'עכשיו משחק! אני אשאל, ואת תלחצי על התמונה הנכונה!',
 'he/g2intro': 'כל הכבוד! עכשיו משחק אחרון, בלי רמזים! אני אומרת מילה, ואת מוצאת את החיה!',
 'he/this_dog': 'זה כלב', 'he/this_cat': 'זה חתול', 'he/this_bird': 'זאת ציפור',
 'he/this_fish': 'זה דג', 'he/this_rabbit': 'זה ארנב',
 'en/dog': 'dog', 'en/cat': 'cat', 'en/bird': 'bird', 'en/fish': 'fish', 'en/rabbit': 'rabbit',
}
L2 = {
 'he/intro1': f'היי {MIA}! שְׂמֵחָה לראות אותך שוב!',
 'he/intro2': 'אני לֵילִי הינשוף, והיום נלמד צבעים באנגלית!',
 'he/move_yellow': 'קומי קומי! מצאי משהו צהוב בחדר!',
 'he/move_green': 'קומי קומי! תגעי במשהו ירוק!',
 'he/g1intro2': 'עכשיו משחק! אני אשאל, ואת תלחצי על הצבע הנכון!',
 'he/g2intro': 'כל הכבוד! עכשיו משחק אחרון, בלי רמזים! אני אומרת מילה, ואת מוצאת את הצבע!',
 'he/this_red': 'זה אדום', 'he/this_blue': 'זה כחול', 'he/this_yellow': 'זה צהוב',
 'he/this_green': 'זה ירוק', 'he/this_purple': 'זה סגול',
 'en/red': 'red', 'en/blue': 'blue', 'en/yellow': 'yellow', 'en/green': 'green', 'en/purple': 'purple',
}

def strip_niqqud(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def norm_he(s):
    s = strip_niqqud(s)
    return re.sub(r'[^א-ת]', '', s)

def lev(a, b):
    m, n = len(a), len(b)
    if m == 0: return n
    prev = list(range(n+1))
    for i in range(1, m+1):
        cur = [i] + [0]*n
        for j in range(1, n+1):
            cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] != b[j-1]))
        prev = cur
    return prev[n]

def tts(text, lang, path):
    body = json.dumps({"text": text, "model_id": "eleven_v4", "language_code": lang})
    r = subprocess.run(['curl','-s','-m','90','-X','POST',
        f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128',
        '-H',f'xi-api-key: {KEY}','-H','Content-Type: application/json','-d',body,
        '-o',path,'-w','%{http_code}'], capture_output=True, text=True)
    return r.stdout.strip() == '200' and os.path.getsize(path) > 5000

def stt(path, lang):
    r = subprocess.run(['curl','-s','-m','90','-X','POST','https://api.elevenlabs.io/v1/speech-to-text',
        '-H',f'xi-api-key: {KEY}','-F','model_id=scribe_v2','-F',f'language_code={lang}','-F',f'file=@{path}'],
        capture_output=True, text=True)
    try: return json.loads(r.stdout).get('text','')
    except Exception: return ''

def verify(heard, text, lang):
    if lang == 'he':
        exp = norm_he(text); got = norm_he(heard)
        if not exp: return False, got
        d = lev(exp, got)
        return d <= max(1, int(0.2*len(exp))), got
    else:
        return text.lower() in heard.lower(), heard

def gen(uid, text, lang):
    path = f'{OUT}/{uid.replace("/","_")}.mp3'
    best = None
    for take in range(3):
        if not tts(text, lang, path):
            time.sleep(1); continue
        heard = stt(path, lang)
        ok, got = verify(heard, text, lang)
        print(f'{uid} take{take+1}: {"OK" if ok else "RETRY"} | heard={got!r}', flush=True)
        if ok:
            return path, got, take+1
        best = (path, got, take+1)
    print(f'{uid}: GIVING UP, keeping last take', flush=True)
    return best

import os.path as _p
results = json.load(open('/home/sandbox/mia-english/.gen/results.json')) if _p.exists('/home/sandbox/mia-english/.gen/results.json') else {}
def do_set(prefix, texts):
    for key, text in texts.items():
        lang = 'en' if key.startswith('en/') else 'he'
        uid = f'{prefix}:{key}'
        if uid in results and results[uid].get('ok'):
            print(f'{uid}: cached OK', flush=True); continue
        path, got, takes = gen(uid, text, lang)
        ok = verify(got if isinstance(got,str) else '', text, lang)[0]
        results[uid] = {'text': text, 'heard': got, 'takes': takes, 'ok': ok}
        json.dump(results, open('/home/sandbox/mia-english/.gen/results.json','w'), ensure_ascii=False, indent=1)

import sys as _s
which = _s.argv[1] if len(_s.argv)>1 else 'all'
if which in ('shared','all'): do_set('shared', SHARED)
if which in ('l1','all'): do_set('l1', L1)
if which in ('l2','all'): do_set('l2', L2)
json.dump(results, open('/home/sandbox/mia-english/.gen/results.json','w'), ensure_ascii=False, indent=1)
print('DONE', len(results), 'unique clips', flush=True)
