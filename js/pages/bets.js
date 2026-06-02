import { renderBetsPage } from '../bets.js';
import { boot } from '../page-boot.js';

boot(async () => {
  await renderBetsPage();
}, { errorTarget: 'bets-root' });
