/*!
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 */

// build.js
const { rollup } = require('rollup');
const { babel } = require('@rollup/plugin-babel'); // 【已修复】从新包导入
const terser = require('@rollup/plugin-terser');
const { nodeResolve } = require('@rollup/plugin-node-resolve'); // 【新增】
const commonjs = require('@rollup/plugin-commonjs'); // 【新增】
const fs = require('fs-extra');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const csso = require('csso');

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

        // 1. 处理 CSS
        const cssContent = await fs.readFile(path.join(srcDir, 'liveplayer.css'), 'utf8');
        await fs.writeFile(path.join(distDir, 'liveplayer.css'), cssContent);
        const minifiedCss = csso.minify(cssContent).css;
        await fs.writeFile(path.join(distDir, 'liveplayer.min.css'), minifiedCss);
        console.log('Processed CSS files.');

        // 2. 准备 JS 源文件 (注入HTML)
        const htmlTemplate = await fs.readFile(path.join(srcDir, 'player.template.html'), 'utf8');
        const minifiedHtml = await minifyHtml(htmlTemplate, { collapseWhitespace: true, removeComments: true });
        let jsContent = await fs.readFile(path.join(srcDir, 'LivePlayer.js'), 'utf8');
        // 使用更健壮的替换方式，以防模板字符串中有特殊字符
        jsContent = jsContent.replace('`__PLAYER_TEMPLATE_HTML__`', `\`${minifiedHtml.replace(/`/g, '\\`')}\``);

        const tempJsPath = path.join(tempDir, 'LivePlayer.temp.js');
        await fs.writeFile(tempJsPath, jsContent);
        console.log('Created temporary JS file with injected HTML.');

        // 3. 【核心修复】Rollup 配置
        const inputOptions = {
            input: tempJsPath,
            external: ['flv.js', 'hls.js'], // 告诉 Rollup 不要打包 flv.js 和 hls.js
            plugins: [
                nodeResolve(), // 帮助 Rollup 查找 node_modules 中的包
                commonjs(),    // 将 CommonJS 模块（如某些依赖）转换为 ES6
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
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 */`,
            sourcemap: true,
            globals: {
                'flv.js': 'flvjs', // 'npm包名': '全局变量名'
                'hls.js': 'Hls'    // 'npm包名': '全局变量名'
            }
        };

        const esmOutputOptions = {
            file: path.join(distDir, 'liveplayer.esm.js'),
            format: 'esm',
            banner: `/*!
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 */`,
            sourcemap: true
        };

        // 4. 打包
        const bundle = await rollup(inputOptions);
        await bundle.write(umdOutputOptions);
        await bundle.write(esmOutputOptions);
        console.log('Generated UMD and ESM bundles.');

        // 5. 创建压缩版本
        if (!isDevBuild) {
            // 在生产构建中添加 terser 插件
            inputOptions.plugins.push(terser());
            const minifiedBundle = await rollup(inputOptions);
            const minifiedUmdOptions = { ...umdOutputOptions, file: path.join(distDir, 'liveplayer.umd.min.js') };
            await minifiedBundle.write(minifiedUmdOptions);
            const minifiedEsmOptions = { ...esmOutputOptions, file: path.join(distDir, 'liveplayer.esm.min.js') };
            await minifiedBundle.write(minifiedEsmOptions);
            console.log('Generated minified bundles.');
        }

        // 6. 清理
        await fs.remove(tempDir);
        console.log('Cleaned up temporary files.');

        console.log('\nLibrary build completed successfully! ✨');

    } catch (error) {
        console.error('\nBuild failed:', error);
        process.exit(1);
    }
}

build();