import { defineConfig } from '@playwright/test';
import config from './playwright.config';
export default defineConfig({ ...config, webServer: {
 command: 'NEXT_DIST_DIR=.next-e2e PLANNER_DATA_MODEL=canonical PLANNER_UI_PREVIEW=enabled PLANNER_UI_V2=enabled NEXT_PUBLIC_APP_URL=http://localhost:3199 npm run start -- --hostname 127.0.0.1 --port 3199',
 url: 'http://127.0.0.1:3199/login', reuseExistingServer: false, timeout: 60000,
}});
