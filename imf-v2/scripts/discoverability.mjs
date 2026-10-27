import assert from 'node:assert/strict';

const PROJECT_NAME = 'International Multicurrency Framework';
const PROJECT_DESCRIPTION = 'Use project tokens as collateral to mint currencies on DogeOS. IMF extends Frankencoin mechanics with one independent system per currency.';
const DOCS_DESCRIPTION = 'Technical guides to project-token collateral, independent currency systems, Frankencoin mechanics, V2 positions and read-only IMF workflows.';
const IMAGE = {
  width: 1344,
  height: 768,
  alt: 'Chairpup in an illustrative treasury world; the imagery does not represent reserves.',
};

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function plainText(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]).replace(/\s+/g, ' ').trim();
}

export function createDiscoverability({ articles, origins, runtime, fixture, review, imageDimensions }) {
  const mode = fixture ? 'fixture' : runtime.registry ? 'testnet' : 'unconfigured';
  const releaseStatus = mode === 'testnet'
    ? 'The public app verifies the USD V2 registry, chain ID, bytecode and contract links before read-only DogeOS Chikyū testnet requests. tUSDC is a deployer-minted test asset, not production USDC; production readiness is not claimed.'
    : mode === 'fixture'
      ? 'This is an explicitly synthetic read-only fixture. Its contracts, balances and quotes are teaching inputs, not deployed state or operational authority.'
      : 'No verified V2 deployment registry is configured in this review. Local planning remains available; no live state or production readiness is claimed.';
  const projectId = `${origins.website}#project`;
  const project = {
    '@type': 'Organization',
    '@id': projectId,
    name: PROJECT_NAME,
    alternateName: 'IMF',
    url: origins.website,
    logo: { '@type': 'ImageObject', url: new URL('assets/imf.svg', origins.website).href },
    description: 'An independent extension of Frankencoin mechanics for project-token collateral and independent currency systems on DogeOS.',
    disambiguatingDescription: 'The International Multicurrency Framework, not the International Monetary Fund. No official Frankencoin or DogeOS affiliation is implied.',
  };
  const application = {
    '@type': 'WebApplication',
    '@id': `${origins.app}#application`,
    name: 'IMF project workspace',
    url: origins.app,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web browser',
    browserRequirements: 'JavaScript is required for interactive planning and blockchain reads; the documentation is readable without JavaScript.',
    description: mode === 'testnet'
      ? 'Inspect the verified USD V2 registry and DogeOS Chikyū testnet state, or prepare project-collateral plans. Read-only: no signing or execution.'
      : 'Prepare project-collateral position plans with exact decimal-aware inputs and optional read-only V2 registry inspection. No signing or execution.',
    featureList: [
      'Separate new position proposals, accepted-term clones and existing-position mints',
      'Exact decimal-aware read models and borrowing quotes',
      'Independent currency systems with bridge, savings, equity and governance reads',
      'Local human and agent planning documents without execution authority',
    ],
    isAccessibleForFree: true,
    author: { '@id': projectId },
  };

  function guideURL(id) {
    assert(articles.some((article) => article.id === id), `Unknown documentation guide: ${id}`);
    return new URL(`guides/${encodeURIComponent(id)}/`, origins.docs).href;
  }

  function guideContent(html) {
    let content = html.replaceAll('{{website}}', origins.website).replaceAll('{{docs}}', origins.docs).replaceAll('{{app}}', origins.app);
    if (mode !== 'unconfigured') {
      const status = mode === 'testnet' ? {
        overview: 'The app verifies the USD V2 registry, chain ID, bytecode and contract links before read-only DogeOS Chikyū testnet requests. tUSDC is a test asset, not production USDC. This release does not claim production availability or inherited audit coverage.',
        position: 'the public release includes the configured USD V2 testnet registry and source-block reads. Position-specific availability still depends on a valid address and current state.',
        configure: 'The public release supplies the USD V2 testnet registry and a public read endpoint; you can also inspect a local registry.',
        current: 'The public release provides read-only DogeOS Chikyū testnet state for the configured USD V2 currency. tUSDC is a test asset. The integration includes no signing, transaction simulation or DEX execution. Local drafts are origin-local and have no cloud sync. Production launch and operational readiness are not claimed.',
        registry: 'The public release includes a USD V2 testnet registry and read-only reconciliation. Production availability and mainnet state are not claimed.',
        source: 'No production source asset is selected. The configured test bridge uses deployer-minted tUSDC, not production USDC.',
        rates: 'For the configured USD V2 testnet registry, use <code>currentRatePPM</code> and pending state from the selected block, not this list. Other currencies and production deployments need their own verified registries and reviewed rate inputs.',
        genesis: 'On the configured USD V2 Chikyū test deployment, six-decimal tUSDC was locked in the USD bridge, which minted 100 nominal K9USD units. Investing those 100 K9USD units into the initially empty Equity contract issued exactly 1,000 pool shares.',
        genesisCaption: 'USD V2 Chikyū test deployment; not production backing.',
      } : {
        overview: 'This explicitly synthetic read-only fixture has no deployed contracts, real reserves or operational authority. Its values are not current on-chain rates or production state.',
        position: 'this synthetic fixture supplies labelled teaching states, not live positions or deployment evidence.',
        configure: 'This fixture supplies synthetic registry and read behavior for testing; no live registry is implied.',
        current: 'This explicitly synthetic fixture supports read/plan testing only. No live deployment, current rates, production launch or operational status is claimed. Local drafts are origin-local and have no cloud sync.',
        registry: 'This fixture uses explicitly synthetic registry data. It does not establish a deployed V2 system, live read reconciliation or production availability.',
        source: 'No production source asset or live bridge registry is configured; this fixture uses valueless synthetic source units.',
        rates: 'This fixture does not supply current rates. For a verified registry, use <code>currentRatePPM</code> and pending state from the selected block, not this dated configuration list.',
        genesis: 'This explicitly synthetic fixture illustrates test-only genesis arithmetic: six-decimal synthetic source tokens produce 100 nominal local units, and investing those units in an initially empty Equity model issues exactly 1,000 synthetic pool shares. It is not deployed state.',
        genesisCaption: 'Valueless synthetic fixture only.',
      };
      const replacements = [
        ['no live V2 deployment registry is configured. This release does not claim a live V2 read connection, current on-chain rates, production availability or audit coverage.', status.overview],
        ['this release has no configured live V2 registry from which to display those states.', status.position],
        ['No such live registry is configured in this release.', status.configure],
        ['No live V2 registry is configured. The integration supports read/plan workflows only and includes no signing, transaction simulation, DEX execution or production publication. Local drafts are origin-local and have no cloud sync. No current rates, live deployment, production launch or verified operational status is claimed.', status.current],
        ['No current V2 deployment registry is configured here, so live read reconciliation and production availability remain unclaimed.', status.registry],
        ['No production source asset or live bridge registry is configured in this integration.', status.source],
        ['If a verified registry is later configured, use <code>currentRatePPM</code> and pending state from the selected block, not this list. No live V2 registry is configured now.', status.rates],
        ["On the test deployment path, six-decimal Test USDC is locked in each currency's own bridge, which mints 100 nominal local units. Investing those 100 local units into an empty Equity contract issues exactly 1,000 pool shares.", status.genesis],
        ['Valueless test fixture only.', status.genesisCaption],
      ];
      for (const [before, after] of replacements) {
        if (content.includes(before)) content = content.replace(before, after);
      }
    }
    return content.replace(/\.\.\/assets\//g, '/assets/').replace(/href="([^"]+)"/g, (_, href) => {
      if (href.startsWith('#')) return `href="${guideURL(href.slice(1))}"`;
      const match = href.match(/^(?:\.\.\/)?docs\/#([a-z0-9-]+)$/);
      return match ? `href="${guideURL(match[1])}"` : `href="${href}"`;
    });
  }

  function guideNavigation(currentId) {
    return articles.map((guide) => `<a href="${guideURL(guide.id)}" data-guide="${guide.id}"${guide.id === currentId ? ' aria-current="page" class="active"' : ''}>${escapeHTML(guide.label)}</a>`).join('');
  }

  function learningNavigation() {
    return `<nav class="lesson-nav" aria-label="Learning paths">${[
      ['project-guide', 'Project workflow'],
      ['borrowing-costs', 'Borrowing costs'],
      ['source-bridge', 'Source bridges'],
      ['savings', 'Savings & equity'],
    ].map(([id, label]) => `<a href="${guideURL(id)}">${label}</a>`).join('')}</nav>`;
  }

  function documentationHome() {
    const cards = articles.map((guide) => `<article><h3><a href="${guideURL(guide.id)}">${escapeHTML(guide.title)}</a></h3><p>${escapeHTML(guide.intro)}</p><a class="guide-link" href="${guideURL(guide.id)}" aria-label="Read ${escapeHTML(guide.label)}">Read ${escapeHTML(guide.label)}</a></article>`).join('');
    return `<article class="doc" id="article" aria-labelledby="docs-title"><span class="tag">Independent extension of Frankencoin mechanics</span><h1 id="docs-title">IMF documentation</h1><p class="lead muted">Understand project-token collateral, independent currency systems and the exact read-only V2 workflow.</p><h2>What is the International Multicurrency Framework?</h2><p>The International Multicurrency Framework (IMF) helps project teams lock project tokens as collateral, mint a selected currency token and plan DEX liquidity with a separate project-token allocation. It extends Frankencoin mechanics on DogeOS without implying official affiliation or inherited audit coverage.</p><p>Each currency is an independent system with its own token, reserves, equity, savings, positions and source bridge. The framework defines 11 currency codes; each needs its own verified V2 deployment before live state can be shown. There is no shared reserve, automatic FX conversion or cross-currency exposure engine.</p><div class="callout"><strong>Current release:</strong> ${escapeHTML(releaseStatus)} The interface does not simulate, sign or broadcast transactions. Planning JSON does not authorize a transaction.</div><section class="guide-index" aria-labelledby="guide-index-title"><h2 id="guide-index-title">Choose a guide</h2><div class="guide-grid">${cards}</div></section><p class="smalltext">IMF means International Multicurrency Framework. It is independent of the International Monetary Fund and is not an official Frankencoin or DogeOS product. Collateral assessment, veto decisions and transaction authorization remain participant responsibilities.</p></article>`;
  }

  function documentationGuide(guide) {
    const index = articles.findIndex((article) => article.id === guide.id);
    const previous = index > 0 ? `<a href="${guideURL(articles[index - 1].id)}">Previous: ${escapeHTML(articles[index - 1].label)}</a>` : '<span></span>';
    const next = index < articles.length - 1 ? `<a href="${guideURL(articles[index + 1].id)}">Next: ${escapeHTML(articles[index + 1].label)}</a>` : '';
    return `<article class="doc" id="article" aria-labelledby="guide-title"><span class="tag">Independent extension of Frankencoin mechanics</span><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${origins.docs}">Documentation</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHTML(guide.label)}</span></nav><h1 id="guide-title" tabindex="-1">${escapeHTML(guide.title)}</h1><p class="lead muted">${escapeHTML(guide.intro)}</p>${learningNavigation()}${guideContent(guide.html)}<div class="doc-nav">${previous}${next}</div></article>`;
  }

  function responsiveImages(html) {
    const decorated = html.replace(/<span class="story-image"><img /g, '<span class="story-image"><img class="story-image-source" ');
    return decorated.replace(/<img\b[^>]*>/g, (tag) => {
      const source = tag.match(/\bsrc="(?:\.\.\/|\/)?assets\/([^"]+\.png)"/);
      if (!source) return tag;
      const file = source[1];
      const dimensions = imageDimensions[file];
      assert(dimensions, `Missing intrinsic image dimensions: ${file}`);
      const className = tag.match(/\bclass="([^"]*)"/)?.[1] || '';
      const stem = file.replace(/\.png$/, '');
      const candidates = [480, 960].filter((width) => imageDimensions[`${stem}-${width}.png`]).map((width) => `/assets/${stem}-${width}.png ${width}w`);
      candidates.push(`/assets/${file} ${dimensions.width}w`);
      let sizes = '(max-width: 700px) calc(100vw - 74px), (max-width: 1280px) 60vw, 760px';
      if (className.includes('app-guide')) sizes = '(max-width: 700px) 58px, 72px';
      else if (className.includes('sidebar-dog')) sizes = '170px';
      else if (className.includes('story-image-source')) sizes = '(max-width: 700px) 125px, (max-width: 1280px) 33vw, 360px';
      else if (file === 'guide-dog.png' && !className) sizes = '(max-width: 700px) calc(100vw - 40px), (max-width: 1280px) 50vw, 590px';
      let result = tag.replace(/\bsrc="[^"]+"/, `src="/assets/${file}"`);
      if (!result.includes(' width=')) result = result.replace('>', ` width="${dimensions.width}" height="${dimensions.height}" decoding="async">`);
      if (candidates.length > 1 && !result.includes(' srcset=')) result = result.replace('>', ` srcset="${candidates.join(', ')}" sizes="${sizes}">`);
      return result;
    });
  }

  function metadata(html, { surface, canonical, title, description, type = 'website', guide }) {
    const image = new URL('assets/imf-social.jpg', origins.website).href;
    const website = {
      '@type': 'WebSite',
      '@id': `${origins.website}#website`,
      url: origins.website,
      name: PROJECT_NAME,
      alternateName: 'IMF',
      description: PROJECT_DESCRIPTION,
      publisher: { '@id': projectId },
      inLanguage: 'en',
    };
    const page = {
      '@type': type,
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: 'en',
      about: { '@id': projectId },
      isPartOf: { '@id': website['@id'] },
    };
    const graph = [project, website, page];
    if (surface === 'website') {
      page.mainEntity = { '@id': application['@id'] };
      graph.push(application);
      const faq = html.match(/<section class="section faq">[\s\S]*?<\/section>/)?.[0] || '';
      const questions = [...faq.matchAll(/<details><summary>([^<]+)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)];
      assert.equal(questions.length, 4, 'Visible FAQ and structured FAQ must stay in sync');
      graph.push({
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        isPartOf: { '@id': website['@id'] },
        mainEntity: questions.map((match) => ({
          '@type': 'Question',
          name: plainText(match[1]),
          acceptedAnswer: { '@type': 'Answer', text: plainText(match[2]) },
        })),
      });
    } else if (surface === 'docs') {
      const docsSite = {
        '@type': 'WebSite',
        '@id': `${origins.docs}#website`,
        url: origins.docs,
        name: 'IMF documentation',
        description: DOCS_DESCRIPTION,
        publisher: { '@id': projectId },
        inLanguage: 'en',
      };
      page.isPartOf = { '@id': docsSite['@id'] };
      graph.push(docsSite);
      if (guide) {
        page['@type'] = 'TechArticle';
        page.headline = guide.title;
        page.author = { '@id': projectId };
        page.publisher = { '@id': projectId };
        page.about = ['Project-token collateral', 'Independent currency systems', 'Frankencoin mechanics', 'Read-only V2 integration'];
        graph.push({
          '@type': 'BreadcrumbList',
          '@id': `${canonical}#breadcrumb`,
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'IMF documentation', item: origins.docs },
            { '@type': 'ListItem', position: 2, name: guide.title, item: canonical },
          ],
        });
      } else {
        page.mainEntity = {
          '@type': 'ItemList',
          numberOfItems: articles.length,
          itemListElement: articles.map((article, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: guideURL(article.id),
            name: article.title,
            description: article.intro,
          })),
        };
      }
    } else {
      page.mainEntity = { '@id': application['@id'] };
      graph.push(application);
    }
    const tags = [
      `<title>${escapeHTML(title)}</title>`,
      `<meta name="description" content="${escapeHTML(description)}">`,
      '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">',
      `<link rel="canonical" href="${escapeHTML(canonical)}">`,
      `<link rel="alternate" hreflang="en" href="${escapeHTML(canonical)}">`,
      '<meta property="og:site_name" content="International Multicurrency Framework">',
      `<meta property="og:type" content="${guide ? 'article' : 'website'}">`,
      `<meta property="og:title" content="${escapeHTML(title)}">`,
      `<meta property="og:description" content="${escapeHTML(description)}">`,
      `<meta property="og:url" content="${escapeHTML(canonical)}">`,
      `<meta property="og:image" content="${image}">`,
      `<meta property="og:image:width" content="${IMAGE.width}">`,
      `<meta property="og:image:height" content="${IMAGE.height}">`,
      `<meta property="og:image:alt" content="${IMAGE.alt}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${escapeHTML(title)}">`,
      `<meta name="twitter:description" content="${escapeHTML(description)}">`,
      `<meta name="twitter:image" content="${image}">`,
      `<meta name="twitter:image:alt" content="${IMAGE.alt}">`,
      `<link rel="sitemap" type="application/xml" href="${new URL('sitemap.xml', origins[surface]).href}">`,
      `<link rel="alternate" type="text/plain" title="Machine-readable project index" href="${new URL('llms.txt', origins[surface]).href}">`,
      `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`,
    ];
    return html
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace(/\s*<meta name="description"[^>]*>/, '')
      .replace('</head>', `  ${tags.join('\n  ')}\n</head>`);
  }

  function robots(surface) {
    return `# Public search and AI crawlers are welcome on this surface.\nUser-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', origins[surface]).href}\n`;
  }

  function sitemap(surface) {
    const urls = surface === 'docs' ? [origins.docs, ...articles.map((guide) => guideURL(guide.id))] : [origins[surface]];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHTML(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
  }

  function llms(surface) {
    const title = surface === 'website' ? PROJECT_NAME : surface === 'docs' ? 'IMF documentation' : 'IMF read-only project workspace';
    return `# ${title}\n\n> IMF means International Multicurrency Framework, not the International Monetary Fund. It is an independent extension of Frankencoin mechanics for project-token collateral and independent currency systems on DogeOS. No official affiliation, inherited audit coverage or production readiness is implied.\n\n## Project facts\n\n- Projects can lock tokens as collateral, mint a selected currency token and plan DEX liquidity with a separate token allocation.\n- Each currency has independent token supply, reserves, equity, savings, positions and source-bridge accounting.\n- The framework defines 11 currency codes. Deployment and currency availability must be established from a verified V2 registry, not inferred from a planning list.\n- There is no shared reserve, automatic FX conversion or cross-currency exposure engine.\n- Collateral assessment and veto decisions remain participant responsibilities.\n\n## Current release\n\n${releaseStatus}\n\nThe frontend is read-only. It does not simulate, sign or broadcast transactions. Exported planning JSON is not transaction authorization. Local drafts are not cloud-synchronized.\n\n## Surfaces\n\n- [Project website](${origins.website}): project journey, independent currency architecture and illustrative learning model.\n- [Technical documentation](${origins.docs}): exact mechanisms, responsibilities and integration boundaries.\n- [Read-only workspace](${origins.app}): registry inspection, read-derived state and human/agent planning.\n\n## Guides\n\n${articles.map((guide) => `- [${guide.title}](${guideURL(guide.id)}): ${guide.intro}`).join('\n')}\n\n## Lineage and scope\n\n- [Frankencoin documentation](https://docs.frankencoin.com/): behavioral background only; not an affiliation or an extension of audit coverage to IMF.\n- tUSDC is a test asset, not production USDC. Production assets, economics, custody, legal review and independent audit remain separate launch gates.\n`;
  }

  return { mode, releaseStatus, guideURL, guideContent, guideNavigation, documentationHome, documentationGuide, responsiveImages, metadata, robots, sitemap, llms };
}
