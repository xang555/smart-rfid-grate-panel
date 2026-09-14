import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Route/server modules use the SvelteKit `$lib` alias; vitest has no
		// SvelteKit plugin loaded, so resolve it the same way Kit does.
		alias: {
			'$lib': path.resolve('./src/lib')
		}
	},
	test: {
		include: ['tests/unit/**/*.{test,spec}.ts'],
		environment: 'node',
		testTimeout: 20000,
		passWithNoTests: true
	}
});
