import { createFeed } from './market.js';
import { mountMarket } from './market-ui.js';
import { initField } from './field.js';
import { initParallax, initProgress, initReveal, initSpotlight } from './motion.js';
import { isStated, loadRegister } from './register.js';
import { renderCA, renderFacts, renderSocial } from './ui.js';

initProgress();
initReveal();
initParallax();
initSpotlight();
initField(document.querySelector('[data-field]'));

const records = await loadRegister();
renderCA(records.ca);
renderSocial(records);
renderFacts(records);
document.documentElement.dataset.registerLoaded = 'true';

const source = records['market-source'];
const market = mountMarket({ topN: isStated(source) && source.topN > 0 ? source.topN : 10 });

// The market follows the market-source record and nothing else.
if (isStated(source)) {
  createFeed(source, { onData: market.update, onStatus: market.setStatus }).start();
} else {
  market.inert();
}
