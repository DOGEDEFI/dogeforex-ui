from pathlib import Path
from html.parser import HTMLParser
from html import unescape
import json
import re
import sys
import xml.etree.ElementTree as ET

root = Path.cwd()
output = root / 'dist'
if len(sys.argv) > 1 and sys.argv[1].startswith('--dist='):
    output = (root / sys.argv[1].split('=', 1)[1]).resolve()
articles = json.loads((root / 'assets/articles.json').read_text())
guides = {article['id']: article for article in articles}


def text(value):
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', '', value))).strip()


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.titles = []
        self._title = False
        self._json = None
        self.structured = []
        self.descriptions = []
        self.robots = []
        self.properties = {}
        self.canonicals = []
        self.h1_count = 0
        self.images = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self._title = True
        if tag == 'h1':
            self.h1_count += 1
        if tag == 'meta' and attrs.get('name') == 'description':
            self.descriptions.append(attrs.get('content', ''))
        if tag == 'meta' and attrs.get('name') == 'robots':
            self.robots.append(attrs.get('content', ''))
        if tag == 'meta' and attrs.get('property', '').startswith('og:'):
            self.properties[attrs['property']] = attrs.get('content', '')
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href', ''))
        if tag == 'img':
            self.images.append(attrs)
        if tag == 'script' and 'src' in attrs:
            self.scripts.append(attrs['src'])
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self._json = []

    def handle_endtag(self, tag):
        if tag == 'title':
            self._title = False
        if tag == 'script' and self._json is not None:
            self.structured.append(json.loads(''.join(self._json)))
            self._json = None

    def handle_data(self, data):
        if self._title:
            self.titles.append(data)
        if self._json is not None:
            self._json.append(data)


page_count = 0
for surface in ['website', 'docs', 'app']:
    base = output / surface
    site_config_text = (base / 'assets/site-config.js').read_text().strip()
    site_config = json.loads(site_config_text.removeprefix('window.IMF_SITE=').removesuffix(';'))
    runtime = json.loads((base / 'assets/runtime.json').read_text())
    testnet_transactions = runtime['mode'] == 'testnet-metamask'
    origin = site_config['origins'][surface]
    robots = (base / 'robots.txt').read_text()
    assert 'User-agent: *\nAllow: /' in robots, f'{surface}: crawler access is not explicit'
    assert f'Sitemap: {origin}sitemap.xml' in robots, f'{surface}: sitemap origin mismatch'
    assert 'Disallow:' not in robots, f'{surface}: unexpected crawler restriction'
    llms = (base / 'llms.txt').read_text()
    assert 'International Money Foundry' in llms
    assert 'not the International Monetary Fund' in llms
    assert 'not transaction authorization' in llms
    if testnet_transactions:
        assert 'wallet' in llms and 'DogeOS Chikyū testnet' in llms
        assert 'tUSDC is a test asset' in llms
        assert 'The frontend is read-only' not in llms
    elif runtime.get('fixture'):
        assert 'isolated mock wallet' in llms
        assert 'non-production fixture' in llms
    for article in articles:
        assert f'{origin if surface == "docs" else site_config["origins"]["docs"]}guides/{article["id"]}/' in llms
    sitemap = ET.parse(base / 'sitemap.xml')
    sitemap_urls = [element.text for element in sitemap.findall('{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    expected_urls = [origin, *[f'{origin}guides/{article["id"]}/' for article in articles]] if surface == 'docs' else [origin]
    assert sitemap_urls == expected_urls, f'{surface}: incorrect sitemap URLs'
    assert all('#' not in url for url in sitemap_urls)
    files = sorted(base.rglob('*.html'))
    assert len(files) == (len(articles) + 1 if surface == 'docs' else 1), f'{surface}: unexpected HTML page count'
    page_count += len(files)
    for file in files:
        source = file.read_text()
        page = Page()
        page.feed(source)
        relative = file.relative_to(base)
        canonical = origin if relative == Path('index.html') else f'{origin}{relative.parent.as_posix()}/'
        expected_scripts = ['/assets/site-config.js', '/assets/currencies.js', '/assets/shared.js']
        if surface == 'website':
            expected_scripts.append('/assets/explore.js')
        elif surface == 'docs':
            expected_scripts.append('/assets/docs.js')
        else:
            expected_scripts.extend(['/assets/protocol.js', '/assets/planning.js', '/assets/offline.js', '/assets/wallet.js', '/assets/dogeos-config.js', '/assets/dogeos.js', '/assets/discovery.js', '/assets/read-cache.js', '/assets/v2.js', '/assets/dashboard.js', '/assets/actions.js', '/assets/app.js'])
        assert page.scripts == expected_scripts, f'{file}: incorrect ordered scripts: {page.scripts}'
        assert len(page.titles) == 1 and page.titles[0].strip(), f'{file}: missing unique title'
        assert len(page.descriptions) == 1 and 60 <= len(page.descriptions[0]) <= 220, f'{file}: missing or inadequate description'
        assert len(page.robots) == 1 and 'index,follow' in page.robots[0] and 'noindex' not in page.robots[0], f'{file}: indexing policy'
        assert page.canonicals == [canonical], f'{file}: canonical mismatch'
        assert page.properties.get('og:url') == canonical, f'{file}: Open Graph URL mismatch'
        assert page.properties.get('og:title') == page.titles[0], f'{file}: Open Graph title mismatch'
        assert page.properties.get('og:description') == page.descriptions[0], f'{file}: Open Graph description mismatch'
        assert page.properties.get('og:image') == f'{site_config["origins"]["website"]}assets/imf-social.jpg'
        assert page.properties.get('og:image:alt')
        assert page.h1_count == 1, f'{file}: expected exactly one H1, got {page.h1_count}'
        if relative == Path('index.html'):
            assert source.count('aria-current="page"') == 1, f'{file}: header must mark the current surface exactly once'
            for label in ('>Website</a>', '>Documentation</a>', '>Workspace</a>'):
                assert label in source, f'{file}: unified surface navigation is missing {label}'
        if surface == 'docs':
            expected_groups = 10 if relative == Path('index.html') else 5
            assert source.count('data-doc-group=') == expected_groups, f'{file}: documentation groups missing or duplicated'
            assert source.count('data-guide="') == len(articles), f'{file}: documentation guide links missing or duplicated'
            for group_label in ('Start here', 'Plan &amp; borrow', 'Liquidity', 'Participate &amp; operate', 'Integrate &amp; status'):
                assert group_label in source, f'{file}: missing guide group {group_label}'
        if surface == 'app':
            assert 'data-view="start"' in source and 'id="start-view"' in source, f'{file}: Start here view missing'
            assert source.count('details class="info"') >= 9, f'{file}: glossary disclosures missing'
        assert len(page.structured) == 1, f'{file}: expected one JSON-LD graph'
        structured = page.structured[0]
        assert structured['@context'] == 'https://schema.org'
        graph = structured['@graph']
        project = next(node for node in graph if node.get('@type') == 'Organization')
        assert project['name'] == 'International Money Foundry'
        assert 'not the International Monetary Fund' in project['disambiguatingDescription']
        assert all(node.get('@id') != '#website' for node in graph)
        for image in page.images:
            assert 'width' in image and 'height' in image and image.get('decoding') == 'async', f'{file}: unstable image dimensions'
            assert 'alt' in image, f'{file}: missing alternative text'
            if image['src'].endswith(('.png', '.jpg')) and (root / 'assets' / image['src'].split('/')[-1].replace('.png', '-480.png')).exists():
                assert '480w' in image.get('srcset', '') and '960w' in image.get('srcset', ''), f'{file}: missing responsive sources'
                assert image.get('sizes'), f'{file}: missing responsive sizes'
        if surface == 'website':
            faq = next((node for node in graph if node.get('@type') == 'FAQPage'), None)
            faq_match = re.search(r'<section class="section faq">[\s\S]*?</section>', source)
            if faq_match:
                visible = re.findall(r'<details><summary>([^<]+)</summary><p>([\s\S]*?)</p></details>', faq_match.group(0))
                assert faq is not None and len(visible) == len(faq['mainEntity']) == 4
                for (question, answer), entity in zip(visible, faq['mainEntity']):
                    assert entity['name'] == text(question)
                    assert entity['acceptedAnswer']['text'] == text(answer)
            else:
                assert faq is None
            assert any(node.get('@type') == 'WebApplication' for node in graph)
        if surface == 'app':
            application = next(node for node in graph if node.get('@type') == 'WebApplication')
            if testnet_transactions:
                assert page.titles[0] == 'IMF Workspace | DogeOS Testnet & Wallet Missions'
                assert 'guided USD wallet transactions after current simulation and explicit review' in page.descriptions[0]
                assert 'production readiness is not claimed' in page.descriptions[0]
                assert 'Read-only' not in page.titles[0] and 'Read-only' not in page.descriptions[0]
                assert 'wallet' in application['description']
                assert any('explicit wallet confirmation' in feature for feature in application['featureList'])
                assert 'wallet is optional' in application['browserRequirements']
            else:
                assert page.titles[0] == 'IMF Workspace | V2 Position Planning'
                assert 'non-executable' in page.descriptions[0]
                assert 'No signing or execution in this review' in page.descriptions[0]
        if surface == 'docs' and testnet_transactions and relative == Path('index.html'):
            assert 'Guided DogeOS testnet transactions are USD-only and require current simulation' in source
            assert 'Imported registries and custom RPC connections remain read-only' in source
            assert '12 independent V2 registries' in source
            assert 'DEX support is not asserted' in source
        if surface == 'docs' and relative != Path('index.html'):
            guide_id = relative.parent.name
            article = guides[guide_id]
            assert article['title'] in unescape(source), f'{file}: missing guide headline without JavaScript'
            assert article['intro'] in unescape(source), f'{file}: missing guide introduction without JavaScript'
            assert source.count('<h2') == article['html'].count('<h2'), f'{file}: guide sections were not pre-rendered'
            assert source.count('<figure') == article['html'].count('<figure'), f'{file}: guide figures were not pre-rendered'
            tech_article = next(node for node in graph if node.get('@type') == 'TechArticle')
            assert tech_article['headline'] == article['title']
            assert tech_article['description'] == article['intro']
            assert any(node.get('@type') == 'BreadcrumbList' for node in graph)

print(f'PASS: {page_count} static HTML pages, canonical metadata, JSON-LD, visible FAQ parity, responsive images, robots.txt, sitemaps and llms.txt for three surfaces')
