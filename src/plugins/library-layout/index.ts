import { createPlugin } from '@/utils';

import style from './style.css?inline';

// Strings are kept inline (not in src/i18n) so the whole plugin lives in this
// folder and upstream merges never touch it.
export default createPlugin({
  name: () => 'Library Layout',
  description: () =>
    'Three-column layout with a fixed library sidebar, folders and local discovery mixes',
  restartNeeded: false,
  config: {
    enabled: true,
  },
  stylesheets: [style],
  renderer: {
    start() {
      document.documentElement.dataset.libraryLayout = 'on';
    },
    stop() {
      delete document.documentElement.dataset.libraryLayout;
    },
  },
});
