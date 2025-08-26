// @ts-check
import { defineConfig } from 'astro/config';

import icon from 'astro-icon';

import expressiveCode from 'astro-expressive-code';

// https://astro.build/config
export default defineConfig({
  integrations: [
    icon(),
    expressiveCode({
      themes: ['catppuccin-macchiato'] //, 'catppuccin-mocha'] // like: nord
    })]
});