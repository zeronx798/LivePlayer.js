/*!
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 */

// build.js
const { rollup } = require('rollup');
const { babel } = require('@rollup/plugin-babel');
const terser = require('@rollup/plugin-terser');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const fs = require('fs-extra');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const csso = require('csso');
const { version } = require('./package.json');
if (!version) {
    throw new Error('Version not found in package.json');
}

const isDevBuild = process.argv.includes('--dev');
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');
const tempDir = path.join(__dirname, 'temp');

async function build() {
    console.log(`Building in ${isDevBuild ? 'development' : 'production'} mode...`);

    try {
        await fs.emptyDir(distDir);
        await fs.emptyDir(tempDir);
        console.log('Cleaned dist and temp directories.');

        // 1. Process CSS
        const cssContent = await fs.readFile(path.join(srcDir, 'liveplayer.css'), 'utf8');
        await fs.writeFile(path.join(distDir, 'liveplayer.css'), cssContent);
        const minifiedCss = csso.minify(cssContent).css;
        await fs.writeFile(path.join(distDir, 'liveplayer.min.css'), minifiedCss);
        console.log('Processed CSS files.');

        // 2. Prepare JS source files (inject into HTML)
        const htmlTemplate = await fs.readFile(path.join(srcDir, 'player.template.html'), 'utf8');
        const minifiedHtml = await minifyHtml(htmlTemplate, { collapseWhitespace: true, removeComments: true });
        let jsContent = await fs.readFile(path.join(srcDir, 'LivePlayer.js'), 'utf8');
        // Use more robust replacement method to handle special characters in template strings
        jsContent = jsContent.replace('`__PLAYER_TEMPLATE_HTML__`', `\`${minifiedHtml.replace(/`/g, '\\`')}\``);
        // replace version string
        jsContent = jsContent.replaceAll('__LIVEPLAYER_VERSION__', version);
        console.log(`Injected version number: ${version}`);

        const tempJsPath = path.join(tempDir, 'LivePlayer.temp.js');
        await fs.writeFile(tempJsPath, jsContent);
        console.log('Created temporary JS file with injected HTML.');

        // 3. Rollup configuration
        const inputOptions = {
            input: tempJsPath,
            external: ['flv.js', 'hls.js'], // Tell Rollup not to bundle flv.js and hls.js
            plugins: [
                nodeResolve(), // Help Rollup find packages in node_modules
                commonjs(),    // Convert CommonJS modules (like some dependencies) to ES6
                babel({
                    babelHelpers: 'bundled',
                    exclude: 'node_modules/**'
                })
            ]
        };

        const umdOutputOptions = {
            file: path.join(distDir, 'liveplayer.umd.js'),
            format: 'umd',
            name: 'LivePlayer',
            banner: `/*!
 * LivePlayer.js v${version}
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 * https://github.com/zeronx798/LivePlayer.js
 */`,
            sourcemap: true,
            globals: {
                'flv.js': 'flvjs', // 'npm-package-name': 'global-variable-name'
                'hls.js': 'Hls'    // 'npm-package-name': 'global-variable-name'
            }
        };

        const esmOutputOptions = {
            file: path.join(distDir, 'liveplayer.esm.js'),
            format: 'esm',
            banner: `/*!
 * LivePlayer.js v${version}
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 * https://github.com/zeronx798/LivePlayer.js
 */`,
            sourcemap: true
        };

        // 4. Bundle
        const bundle = await rollup(inputOptions);
        await bundle.write(umdOutputOptions);
        await bundle.write(esmOutputOptions);
        console.log('Generated UMD and ESM bundles.');

        // 5. Create minified version
        if (!isDevBuild) {
            // Add terser plugin for production build
            inputOptions.plugins.push(terser());
            const minifiedBundle = await rollup(inputOptions);
            const minifiedUmdOptions = { ...umdOutputOptions, file: path.join(distDir, 'liveplayer.umd.min.js') };
            await minifiedBundle.write(minifiedUmdOptions);
            const minifiedEsmOptions = { ...esmOutputOptions, file: path.join(distDir, 'liveplayer.esm.min.js') };
            await minifiedBundle.write(minifiedEsmOptions);
            console.log('Generated minified bundles.');
        }

        // 6. Cleanup
        await fs.remove(tempDir);
        console.log('Cleaned up temporary files.');

        console.log('\nLibrary build completed successfully! ✨');

    } catch (error) {
        console.error('\nBuild failed:', error);
        process.exit(1);
    }
}

build();