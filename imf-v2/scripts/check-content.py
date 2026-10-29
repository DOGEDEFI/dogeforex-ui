from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json
import re
import sys

source_mode = len(sys.argv) == 1
root = Path.cwd()
output = root / 'dist'
if len(sys.argv) > 1 and sys.argv[1].startswith('--dist='):
    output = (root / sys.argv[1].split('=', 1)[1]).resolve()
articles = json.loads((root / 'assets/articles.json').read_text())
article_ids = {article['id'] for article in articles}
required_ids = {'overview', 'project-guide', 'collateral', 'mechanism', 'currencies', 'liquidity', 'agents', 'responsibilities', 'overcollateralization', 'oracle-free', 'governance', 'equity', 'architecture', 'borrowing-costs', 'repayment', 'maturity', 'source-bridge', 'savings'}
assert len(articles) == len(article_ids) >= 18 and required_ids <= article_ids
codes = json.loads((root / 'assets/currencies.json').read_text())
assert len(codes) == 12 and len({code for code, _ in codes}) == 12
glossary = json.loads((root / 'assets/glossary.json').read_text())
glossary_terms = {entry['term'] for entry in glossary}
assert len(glossary) == len(glossary_terms) and all(entry['guide'] in article_ids for entry in glossary), 'glossary terms must be unique and point at real guides'

class Check(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = set()
        self.scripts = []
        self.buttons = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'Duplicate ID ' + attrs['id']
            self.ids.add(attrs['id'])
        if tag == 'script' and 'src' in attrs:
            self.scripts.append(attrs['src'])
        if 'data-view' in attrs:
            self.buttons.append(attrs['data-view'])
        if 'data-start-target' in attrs:
            self.buttons.append(attrs['data-start-target'])
        for attr in ['src', 'href']:
            if attr in attrs:
                self.links.append(attrs[attr])
        if 'srcset' in attrs:
            self.links.extend(candidate.strip().split()[0] for candidate in attrs['srcset'].split(','))

files = [Path('index.html'), Path('app/index.html'), Path('docs/index.html')] if source_mode else sorted(output.glob('**/*.html'))
parsers = {}
for file in files:
    source = file.read_text()
    parser = Check()
    parser.feed(source)
    parsers[file.resolve()] = parser
    for view in parser.buttons:
        assert (file.parent / f'{view}-view.html').exists() or f'id="{view}-view"' in source, f'Missing view {view}'
    used_terms = set(re.findall(r'data-term="([a-z0-9-]+)"', source))
    assert used_terms <= glossary_terms, f'{file}: unknown glossary terms {sorted(used_terms - glossary_terms)}'

count = 0
for file, parser in parsers.items():
    for link in parser.links:
        if '{{' in link:
            continue
        parsed = urlsplit(link)
        if parsed.scheme or parsed.netloc:
            continue
        if parsed.path.startswith('/') and not source_mode:
            surface = file.relative_to(output).parts[0]
            target = (output / surface / unquote(parsed.path.lstrip('/'))).resolve()
        else:
            target = (file.parent / unquote(parsed.path)).resolve() if parsed.path else file
        if target.is_dir():
            target = target / 'index.html'
        assert target.exists(), f'{file}: missing {link}'
        if parsed.fragment:
            if target == (root / 'docs/index.html').resolve():
                assert parsed.fragment in article_ids or parsed.fragment in parsers[target].ids, link
            elif target in parsers:
                assert parsed.fragment in parsers[target].ids or parsed.fragment in parsers[target].buttons, link
        count += 1

for article in articles:
    parser = Check()
    parser.feed(article['html'])
    for link in parser.links:
        if '{{' in link:
            continue
        parsed = urlsplit(link)
        if parsed.scheme or parsed.netloc:
            continue
        if not parsed.path and parsed.fragment:
            assert parsed.fragment in article_ids, link
        elif parsed.path:
            if source_mode:
                target = (root / 'docs' / unquote(parsed.path)).resolve()
            elif parsed.path.startswith('../assets/'):
                target = (output / 'docs/assets' / parsed.path.removeprefix('../assets/')).resolve()
            else:
                target = (output / 'docs' / unquote(parsed.path)).resolve()
            if target.is_dir():
                target = target / 'index.html'
            assert target.exists(), f'{article["id"]}: missing {link}'
        count += 1
    assert '<figure' in article['html'] and '<figcaption' in article['html'], article['id']

if not source_mode:
    for surface in ['website', 'docs', 'app']:
        base = output / surface
        for required in ['index.html', 'robots.txt', 'sitemap.xml', 'llms.txt', 'assets/imf-social.jpg', 'assets/style.css', 'assets/shared.js', 'assets/site-config.js', 'assets/currencies.js', 'assets/runtime.json', 'assets/glossary.json']:
            assert (base / required).is_file(), f'{surface}: missing {required}'
        for internal in ['PLAN.html', 'AGENTS.md', 'handoff', 'scripts', 'node_modules']:
            assert not (base / internal).exists(), f'{surface}: internal file published: {internal}'
    for required in ['protocol.js', 'planning.js', 'offline.js', 'wallet.js', 'discovery.js', 'v2.js', 'actions.js', 'app.js']:
        assert (output / 'app/assets' / required).is_file(), f'app: missing {required}'
    app_html = (output / 'app/index.html').read_text()
    runtime = json.loads((output / 'app/assets/runtime.json').read_text())
    if runtime['mode'] == 'testnet-metamask':
        assert runtime['status'] == 'configured-testnet-metamask'
        assert '<title>IMF Workspace | DogeOS Testnet V2 &amp; MetaMask</title>' in app_html
        assert 'guided USD MetaMask transactions after current simulation and explicit review' in app_html
        assert 'DogeOS testnet · 12 verified currencies' in app_html
        assert 'tUSDC is a test asset; production readiness is not claimed' in app_html
        for stale in ['Read-only V2 preview', 'network execution is not connected', 'no production V2 registry', 'This frontend does not do so']:
            assert stale not in app_html, f'app: stale testnet content: {stale}'
    else:
        assert '<title>IMF Workspace | V2 Position Planning</title>' in app_html
        assert 'No signing or execution in this review' in app_html
        if runtime.get('fixture'):
            site_config = (output / 'app/assets/site-config.js').read_text()
            assert 'explicitly synthetic, non-production fixture' in site_config
            assert 'isolated mock wallet' in site_config

print(f'PASS: {count} local references, unique page IDs, {len(articles)} illustrated guide routes, 12 currencies, separate surface assets and runtime-specific metadata')
