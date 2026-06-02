import { renderChampionSection } from '../champion.js';
import { boot } from '../page-boot.js';

boot(async () => {
  renderChampionSection('champion-section', { compact: true });
}, { errorTarget: 'champion-section' });
