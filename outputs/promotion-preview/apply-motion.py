from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
preview = root / 'outputs/promotion-preview'
page = root / '仿真通-宣传页.html'
html = page.read_text(encoding='utf-8')

old_title = '<h1 id="hero-heading">让工程难题，<br>有专业回应。</h1>'
new_title = '<h1 id="hero-heading" aria-label="让工程难题，有专业回应。"><span aria-hidden="true"><span class="motion-word">让工程</span><span class="motion-word">难题，</span><br><span class="motion-word">有专业</span><span class="motion-word">回应。</span></span></h1>'
if old_title in html:
    html = html.replace(old_title, new_title, 1)
assert new_title in html

if 'class="software-loop-frame"' not in html:
    match = re.search(r'<div class="software-list">.*?</div>', html)
    assert match
    original = match.group(0)
    markup = '<div class="software-loop-frame"><div class="software-loop"><div class="software-loop-track">' + original + '</div></div><button class="software-loop-toggle" aria-label="暂停软件名称滚动" aria-pressed="false" hidden><svg class="icon loop-pause-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3v10M11 3v10"/></svg><svg class="icon loop-play-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="m5 3 8 5-8 5V3Z"/></svg></button></div>'
    html = html[:match.start()] + markup + html[match.end():]

css = (preview / 'motion.css').read_text(encoding='utf-8')
script = (preview / 'motion.js').read_text(encoding='utf-8')
license = (preview / 'react-bits-LICENSE.md').read_text(encoding='utf-8')
css_block = '/* REACT_BITS_MOTION_START */\n' + css + '\n/* REACT_BITS_MOTION_END */'
script_block = '// REACT_BITS_MOTION_START\n' + script + '\n// REACT_BITS_MOTION_END'
if '/* REACT_BITS_MOTION_START */' in html:
    html = re.sub(r'/\* REACT_BITS_MOTION_START \*/.*?/\* REACT_BITS_MOTION_END \*/', lambda _:css_block, html, count=1, flags=re.S)
else:
    html = html.replace('</style>', css_block + '\n  </style>', 1)
if '// REACT_BITS_MOTION_START' in html:
    html = re.sub(r'// REACT_BITS_MOTION_START.*?// REACT_BITS_MOTION_END', lambda _:script_block, html, count=1, flags=re.S)
else:
    html = html.replace('  </script>', script_block + '\n  </script>', 1)
if '<!-- REACT_BITS_ATTRIBUTION_START' not in html:
    credit = '<!-- REACT_BITS_ATTRIBUTION_START\nMotion adapted from React Bits by David Haz.\nhttps://reactbits.dev/\nhttps://github.com/DavidHDev/react-bits\n\n' + license + '\nREACT_BITS_ATTRIBUTION_END -->\n'
    html = html.replace('  <script>', credit + '  <script>', 1)
page.write_text(html, encoding='utf-8')
(preview / 'page-script-check.js').write_text(html.split('<script>',1)[1].split('</script>',1)[0],encoding='utf-8')
print('Applied 5 React Bits motion adaptations; single-file HTML remains self-contained.')
