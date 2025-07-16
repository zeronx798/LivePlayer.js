# LivePlayer.js

A self-contained, zero-dependency, and configurable FLV and HLS live player component with intelligent offline detection.

LivePlayer.js provides a robust solution for embedding live video streams into your web pages. It intelligently handles both FLV and HLS formats, with automatic fallback and recovery mechanisms. Its standout feature is the ability to accurately determine when a stream has truly ended, preventing the common infinite-loading loop and providing a superior user experience.

## Features

*   **Intelligent Stream-End Detection:** Accurately distinguishes between a temporary network stall and a permanent stream stop (e.g., broadcaster going offline). This prevents frustrating infinite-reconnect loops and provides a clear status to the viewer.
*   **Dual Protocol Support:** Seamlessly plays both FLV (`.flv`) and HLS (`.m3u8`) live streams using `flv.js` and `hls.js`.
*   **Multiple Build Formats (UMD & ESM):** Can be used directly in a browser via a `<script>` tag or imported as an ES Module in modern frameworks like Vue, React, or Angular.
*   **Smart Fallback:** Configure primary and fallback stream URLs. If the primary stream fails, the player will automatically attempt to play the fallback.
*   **Automatic Recovery:** Intelligently handles network interruptions, attempting to reconnect a limited number of times before declaring the stream offline.
*   **Live Edge Maintenance:** Includes an optional feature to keep the playback near the live edge, reducing latency for viewers.
*   **Customizable UI:** Clean and simple player interface with essential controls, using Font Awesome for icons.

---

## Installation & Usage

This library can be used in two primary ways: directly in an HTML file or by installing it as an npm module in a modern JavaScript project.

### Method 1: Direct Usage in HTML with `<script>` Tags

This is the simplest way to get started. You can include the UMD (Universal Module Definition) version of the library directly on your page. This method is ideal for static websites or simple integrations.

**1. Include Files in HTML:**

Add the library's CSS, its dependencies (`Font Awesome`, `flv.js`, `hls.js`), and the `liveplayer.umd.js` script to your HTML file.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>LivePlayer Example</title>
    <!-- 1. Font Awesome for Icons -->
    <link rel="stylesheet" href="path/to/font-awesome/css/all.min.css">
    <!-- 2. LivePlayer CSS -->
    <link rel="stylesheet" href="path/to/liveplayer/dist/liveplayer.min.css">
</head>
<body>
    <div id="player-container" style="width: 800px; height: 450px;"></div>

    <!-- 3. Core Dependencies -->
    <script src="path/to/flv.js/dist/flv.min.js"></script>
    <script src="path/to/hls.js/dist/hls.min.js"></script>
    <!-- 4. LivePlayer Library (UMD version) -->
    <script src="path/to/liveplayer/dist/liveplayer.umd.min.js"></script>

    <!-- 5. Your initialization script -->
    <script>
        // Initialization code here
    </script>
</body>
</html>
```

**2. Initialize the Player:**

The UMD script creates a global `LivePlayer` class that you can use to instantiate the player.

```html
<script>
    document.addEventListener('DOMContentLoaded', function() {
        const playerElement = document.getElementById('player-container');

        const options = {
            streamUrls: {
                'HD': 'https://example.com/stream.flv',
                'SD': { url: 'https://example.com/stream_sd.flv', fallback: 'https://example.com/stream_sd.m3u8' }
            },
            logLevel: 'info',
            debugUI: true,
            liveEdge: {
                enabled: true,
                latency: 15.0 // seconds
            }
        };

        try {
            // The LivePlayer class is globally available
            const player = new LivePlayer(playerElement, options);
        } catch (error) {
            console.error("Failed to initialize LivePlayer:", error);
        }
    });
</script>
```

### Method 2: As an NPM Module in a Build System (e.g., Vite, Webpack)

This is the recommended approach for modern web applications built with frameworks like **Vue, React, Angular, or Svelte**. This method uses the ESM (ECMAScript Module) build of the library.

**1. Install the Library and its Dependencies:**

From your project's root directory, run:

```bash
# Using npm
npm install @zeronx/liveplayer flv.js hls.js

# Using yarn
yarn add @zeronx/liveplayer flv.js hls.js
```

**2. Import and Use in Your Project:**

You can now import the `LivePlayer` class and its CSS directly into your JavaScript or TypeScript files.

```javascript
// In your component or main JS file (e.g., main.js, App.vue, App.jsx)

// Import the player class
import LivePlayer from '@zeronx/liveplayer'; // Or the path to the esm build
// Import the player's CSS
import '@zeronx/liveplayer/dist/liveplayer.min.css';

// Find your container element (example for a generic setup)
const playerElement = document.getElementById('player-container');

// Define your options
const options = {
    streamUrls: {
        'HD': 'https://example.com/stream.flv',
        'SD': 'https://example.com/stream.m3u8'
    },
    logLevel: 'info'
};

// Create the player instance
if (playerElement) {
    const player = new LivePlayer(playerElement, options);
}
```

---

## Build Files Explained

The `dist` directory contains several versions of the library, tailored for different use cases:

*   `liveplayer.umd.js`: The UMD version for use in browsers via `<script>` tags. Creates a global `window.LivePlayer` object.
*   `liveplayer.umd.min.js`: The minified version of the UMD build, suitable for production.
*   `liveplayer.esm.js`: The ESM version for use with `import` syntax in modern browsers and build tools.
*   `liveplayer.esm.min.js`: The minified version of the ESM build.
*   `liveplayer.css`: The unminified stylesheet.
*   `liveplayer.min.css`: The minified stylesheet for production.

---

## Configuration Options

You can customize the player by passing an options object to the constructor.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `streamUrls` | `object` | `{}` | An object where keys are quality labels (e.g., 'HD') and values are either a single URL string or an object with `url` and `fallback` properties. |
| `logLevel` | `string` | `'prod'` | The logging level. Can be `'debug'`, `'info'`, or `'prod'`. |
| `debugUI` | `boolean` | `false` | If `true`, a debug log panel is displayed below the player. |
| `liveEdge` | `object` | | Configuration for the live edge synchronization feature. |
| `liveEdge.enabled` | `boolean` | `false` | Enables the custom latency checker for FLV streams. |
| `liveEdge.interval` | `number` | `120000` | The interval in milliseconds to check for latency. |
| `liveEdge.latency` | `number` | `20.0` | The maximum allowed latency in seconds before seeking to the live edge. |
| `liveEdge.hlsConfig` | `object` | | Advanced configuration for the underlying `hls.js` instance. See below for details. |

### Advanced HLS Configuration (`liveEdge.hlsConfig`)

These options are passed directly to `hls.js` to fine-tune its behavior for robust live streaming.

| HLS Option | Default | Description |
| --- | --- | --- |
| `liveSyncDurationCount`| `3` | Number of segments to keep from the live edge. |
| `liveMaxLatencyDurationCount`| `5` | If latency exceeds this many segments, `hls.js` will seek or speed up playback. |
| `manifestLoadErrorMaxRetry`| `5` | Number of times to retry loading the manifest on error. |
| `manifestLoadErrorRetryDelay`| `1000`| Delay in ms between manifest retry attempts. |
| `levelLoadErrorMaxRetry`| `5` | Number of times to retry loading a playlist/segment on error. |
| `levelLoadErrorRetryDelay`| `1000` | Delay in ms between segment retry attempts. |
| `maxBufferHole` | `2.0` | Allows seeking over a gap of up to 2 seconds in the buffer to recover from stalls. |

## Browser Support

LivePlayer.js relies on `flv.js` and `hls.js`, which in turn depend on the Media Source Extensions (MSE) API. It is supported by all modern browsers, including:

*   Chrome
*   Firefox
*   Safari
*   Edge
*   Opera

## License

This project is licensed under the **Mozilla Public License 2.0**. A copy of the license is available in the [`LICENSE`](LICENSE) file.

### Third-Party Licenses

This project incorporates components from other open source projects. The original licenses for these components can be found in the [`LICENSES/`](LICENSES/) directory.

