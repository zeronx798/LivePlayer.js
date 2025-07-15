/*!
 * SPDX-FileCopyrightText: 2025 The LivePlayer Project Authors
 * SPDX-License-Identifier: MPL-2.0
 */

/**
 * @file liveplayer.js
 * @description A self-contained, zero-dependency and configurable FLV and HLS live player component.
 * @version 1.0.0-SNAPSHOT
 */

import flvjs from 'flv.js';
import Hls from 'hls.js';

/**
 * Represents a configurable FLV live player component.
 * It handles stream playback, UI controls, error recovery, and optional debug logging.
 */
export default class LivePlayer {
    /**
     * Creates an instance of LivePlayer.
     * @param {HTMLElement} element The container element where the player will be injected.
     * @param {object} [options={}] Configuration options for the player.
     * @param {object} [options.streamUrls={}] An object of stream sources. Can be in simple format ('Line': 'url')
     * or advanced format with fallback ('Line': { url: 'primary.flv', fallback: 'fallback.m3u8' }).
     * @param {('debug'|'info'|'prod')} [options.logLevel='prod'] The logging level. 'debug' shows all logs, 'info' shows informational and error logs, 'prod' shows only critical errors.
     * @param {boolean} [options.debugUI=false] If true, a debug log textarea will be displayed below the player.
     * @param {object} [options.liveEdge] Configuration for maintaining playback near the live edge.
     * @param {boolean} [options.liveEdge.enabled=false] Whether to enable the live edge seeking feature.
     * @param {number} [options.liveEdge.interval=5000] The interval in milliseconds to check latency.
     * @param {number} [options.liveEdge.latency=5.0] The maximum allowed latency in seconds before seeking to the live edge.
     */
    constructor(element, options = {}) {
        if (!element) throw new Error("A container element must be provided.");

        this.container = element;
        this.id = this.container.id || `liveplayer-${Math.random().toString(36).substr(2, 9)}`;

        // --- MODIFIED: Integrate robust HLS settings into defaultOptions ---
        const defaultOptions = {
            streamUrls: {},
            logLevel: 'prod',
            debugUI: false,
            liveEdge: {
                enabled: false, // This is for our custom FLV latency checker
                interval: 120000,
                latency: 20.0,

                // --- NEW: Centralized and robust hls.js default configuration ---
                hlsConfig: {
                    // Latency and sync controls
                    liveSyncDurationCount: 3,       // Try to stay 3 segments from the live edge
                    liveMaxLatencyDurationCount: 5, // If latency exceeds 5 segments, hls.js will speed up or seek

                    // Robustness and retry strategy
                    manifestLoadErrorMaxRetry: 5,   // Retry manifest loading 5 times
                    manifestLoadErrorRetryDelay: 1000, // 1s delay between manifest retries
                    levelLoadErrorMaxRetry: 5,      // Retry playlist/segment loading 5 times
                    levelLoadErrorRetryDelay: 1000, // 1s delay between segment retries

                    // Error recovery
                    maxBufferHole: 2.0, // Allow seeking over a 2-second gap in the buffer
                }
            }
        };

        // --- MODIFIED: Deep merge user options over the new defaults ---
        // The deep merge logic needs to correctly handle the nested hlsConfig object.
        this.options = {
            ...defaultOptions,
            ...options,
            liveEdge: {
                ...defaultOptions.liveEdge,
                ...(options.liveEdge || {}),
                // Ensure hlsConfig is also merged, not just replaced
                hlsConfig: {
                    ...defaultOptions.liveEdge.hlsConfig,
                    ...((options.liveEdge && options.liveEdge.hlsConfig) || {})
                }
            }
        };

        // --- Internal State ---
        /** @type {flvjs.Player | null} The flv.js player instance. */
        this.flvPlayer = null;
        /** @type {Hls | null} The hls.js player instance. */
        this.hlsPlayer = null;
        /** @type {'flv' | 'hls' | null} The type of the current active player. */
        this.currentPlayerType = null;
        /** @type {string | null} The URL of the currently playing stream. */
        this.currentUrl = null;
        /** @type {boolean} Tracks if the user has interacted with the player. */
        this.userInteracted = false;
        /** @type {boolean} Indicates if the player is currently in a loading state. */
        this.isLoading = true;
        /** @type {number | null} Timeout ID for hiding the controls. */
        this.controlsTimeout = null;
        /** @type {string[]} A history of log messages for the debug UI. */
        this.logHistory = [];
        /** @type {boolean} Stores the muted state before the page becomes hidden. */
        this.wasMutedBeforeHidden = false;
        /** @type {number | null} Interval ID for the latency checker. */
        this.latencyChecker = null;
        /** @type {number | null} Interval ID for the offline poller. */
        this.offlinePoller = null;
        /** @type {number} Delay in ms for a polling retry when offline. */
        this.offlinePollInterval = 5000; // (5 seconds)
        /** 
         * @private 
         * @type {number} Counts consecutive recovery attempts for断流. 
         */
        this.recoveryAttempts = 0;
        /** 
         * @private 
         * @type {number} The number of attempts to tolerate before declaring stream offline.
         */
        this.maxRecoveryAttempts = 3;
        /** @type {string | null} The URL of the currently playing stream. */
        this.currentUrl = null;
        /** 
         * @private
         * @type {string | null} The primary URL selected by the user, before any fallback logic.
         * This is crucial for correct polling and recovery.
         */
        this.userSelectedUrl = null;
        /** @type {boolean} Tracks if the user has interacted with the player. */
        this.userInteracted = false;

        // New states for robust HLS stall detection
        /** @private */
        this.isObservingStall = false;
        /** @private */
        this.stallObserverTimer = null;
        /** 
         * @private
         * @type {string | null} Caches the content of the last known-stale media playlist.
         * This is the key to breaking the poll-reconnect-fail loop.
         */
        this.lastKnownStaleContent = null;

        /** @private */
        this.logLevelMap = { 'debug': 0, 'info': 1, 'prod': 2, 'error': 2 };
        /** @private */
        this.numericLogLevel = this.logLevelMap[this.options.logLevel] ?? 2;

        try {
            this.streamUrlList = this.parseStreamUrls(this.options.streamUrls);
            this.injectHTML();
            this.initDOMElements();
            this.initEventListeners();
            this.updateAllUI();
            this.log('Constructor finished.', 'debug');
        } catch (error) {
            this.displayError(error.message);
            this.log(error.message, 'error');
        }
    }

    /**
     * Starts the player by loading the first available stream source.
     */
    start() {
        this.log('Player instance starting...', 'info');
        if (this.streamUrlList.length > 0) {
            // A new start action resets any previous recovery attempts.
            this.recoveryAttempts = 0;
            // setupPlayer 现在是智能的，直接调用即可
            this.setupPlayer(this.streamUrlList[0].url, 'initial load');
        } else {
            this.displayError('No stream sources provided to start.');
        }
    }

    /**
     * Destroys the player instance, cleans up resources, and removes it from the DOM.
     */
    destroy() {
        this.log('Destroying player instance...', 'info');
        if (this.flvPlayer) {
            this.flvPlayer.destroy();
            this.flvPlayer = null;
        }
        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
            this.hlsPlayer = null;
        }
        if (this.latencyChecker) {
            clearInterval(this.latencyChecker);
        }
        this.clearOfflineState(); // Also clears the offlinePoller
        this.resetStallObservation(); // Clears the stallObserverTimer
        this.recoveryAttempts = 0; // 重置计数器
        this.container.innerHTML = '';
        this.currentPlayerType = null;
    }

    /**
     * Parses the stream URLs object into a normalized array format.
     * It handles both simple ('name': 'url') and advanced ('name': {url: '...', fallback: '...'}) formats.
     * @private
     * @param {object} urlsObject - The stream URLs object from options.
     * @returns {Array<{name: string, url: string, fallback: string | null}>} An array of normalized stream objects.
     * @throws {Error} If the input is not a valid, non-empty object or contains no valid entries.
     */
    parseStreamUrls(urlsObject) {
        this.log('Parsing stream URLs from options...', 'debug');
        if (typeof urlsObject !== 'object' || urlsObject === null || Array.isArray(urlsObject)) {
            throw new Error('streamUrls option must be a non-empty object.');
        }

        const urls = Object.entries(urlsObject).map(([name, value]) => {
            if (typeof value === 'string') {
                // Simple format
                return { name, url: value, fallback: null };
            } else if (typeof value === 'object' && value !== null && value.url) {
                // Advanced format with fallback
                return { name, url: value.url, fallback: value.fallback || null };
            } else {
                // Invalid format for this entry
                this.log(`Invalid stream format for line: "${name}". Entry skipped.`, 'warn', { entry: value });
                return null;
            }
        }).filter(Boolean); // Filter out any null (invalid) entries

        if (urls.length === 0) {
            throw new Error('streamUrls object is empty or contains no valid entries.');
        }

        this.log(`Successfully parsed ${urls.length} lines.`, 'debug', { parsedData: urls });
        return urls;
    }

    /**
     * Injects the player's HTML structure into the container.
     * @private
     */
    injectHTML() {
        const logHTML = this.options.debugUI ? `<textarea class="log-output" readonly></textarea>` : '';
        this.container.classList.add('live-player-component');
        this.container.innerHTML = `__PLAYER_TEMPLATE_HTML__` + logHTML;
    }

    /**
     * Caches references to all necessary DOM elements.
     * @private
     */
    initDOMElements() {
        this.playerContainer =
            this.container.querySelector(".player-container");
        this.video = this.container.querySelector(".video-element");
        this.video.disablePictureInPicture = false;
        this.controls = this.container.querySelector(".controls-container");
        this.errorOverlay = this.container.querySelector(
            ".player-error-overlay"
        );
        this.offlineOverlay = this.container.querySelector(".player-offline-overlay");
        this.loadingOverlay = this.container.querySelector(".loading-overlay");
        // FIX: Use this.options.debugUI instead of undefined this.isDebugUI
        if (this.options.debugUI) {
            this.logOutput = this.container.querySelector(".log-output");
        }
        this.playPauseBtn = this.container.querySelector(".play-pause-btn");
        this.refreshBtn = this.container.querySelector(".refresh-btn");
        this.muteBtn = this.container.querySelector(".mute-btn");
        this.volumeSlider = this.container.querySelector(".volume-slider");
        this.volumeContainer =
            this.container.querySelector(".volume-container");
        this.unmuteNotice = this.container.querySelector(".unmute-notice");
        this.lineSwitchBtn = this.container.querySelector(".line-switch-btn");
        this.lineSwitchMenu = this.container.querySelector(".line-switch-menu");
        this.pipBtn = this.container.querySelector(".pip-btn");
        this.fullscreenBtn = this.container.querySelector(".fullscreen-btn");
        // 该方法主体不变，仅需确认此处使用的 `this.streamUrlList` 已经是新格式
        // 并且 `li.dataset.url = line.url` 的行为是正确的（它应该始终指向主URL）
        this.streamUrlList.forEach((line, index) => {
            const li = document.createElement("li");
            li.textContent = line.name;
            // 确保使用标准化的 `url` 属性
            li.dataset.url = line.url;
            if (index === 0) li.classList.add("active");
            this.lineSwitchMenu.appendChild(li);
        });
    }

    /**
     * Initializes all event listeners for the player UI and video element.
     * @private
     */
    initEventListeners() {
        const handleFirstInteraction = () => {
            if (!this.userInteracted) {
                this.userInteracted = true;
                if (this.video.muted) this.video.muted = false;
                if (this.video.paused) this.togglePlay();
            }
        };
        this.container.addEventListener("click", handleFirstInteraction);
        this.playPauseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.togglePlay();
        });
        this.video.addEventListener("play", () => {
            if (!this.isLoading) this.updatePlayPauseUI();
        });
        this.video.addEventListener("pause", () => {
            if (!this.isLoading) this.updatePlayPauseUI();
        });
        this.refreshBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            // A manual refresh should reset any previous recovery attempts.
            this.recoveryAttempts = 0;
            this.setupPlayer(this.currentUrl, "refresh");
        });
        this.muteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.video.muted = !this.video.muted;
        });
        this.volumeSlider.addEventListener("input", (e) => {
            this.video.volume = e.target.value;
            this.video.muted = e.target.value == 0;
        });
        this.video.addEventListener("volumechange", () => {
            if (!this.isLoading) this.updateVolumeUI();
        });
        this.lineSwitchBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.lineSwitchMenu.classList.toggle("visible");
        });
        this.lineSwitchMenu.addEventListener("click", (e) => {
            e.stopPropagation();
            if (e.target.tagName === "LI") this.switchLine(e.target);
        });
        document.addEventListener("click", () => {
            if (this.lineSwitchMenu?.classList.contains("visible"))
                this.lineSwitchMenu.classList.remove("visible");
        });
        if (document.pictureInPictureEnabled) {
            this.pipBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.togglePip();
            });
        } else {
            this.pipBtn.style.display = "none";
        }
        this.fullscreenBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleFullscreen();
        });
        document.addEventListener("fullscreenchange", () =>
            this.updateFullscreenUI()
        );
        this.playerContainer.addEventListener("mousemove", () =>
            this.showControls()
        );
        this.playerContainer.addEventListener("mouseleave", () =>
            this.hideControlsOnLeave()
        );
        document.addEventListener("visibilitychange", () =>
            this.handleVisibilityChange()
        );
        // 添加 seeked 事件监听器。当视频完成寻址操作后，隐藏加载动画。
        // 这适用于所有寻址场景，包括我们主动追赶进度。
        this.video.addEventListener('seeked', () => {
            this.log('Video seek completed.', 'debug');
            if (this.loadingOverlay) {
                this.loadingOverlay.style.display = 'none';
            }
        });
        // This is now the PRIMARY and sole trigger for hiding the overlay
        // when playback successfully starts, preventing premature hiding.
        this.video.addEventListener('playing', () => {
            this.log('Video playback has started. Hiding loading overlay.', 'debug');
            if (this.isObservingStall) {
                this.log('Ignoring "playing" event because a critical HLS investigation is in progress.', 'warn');
                return; // ABORT. Do not touch any state.
            }

            if (this.loadingOverlay) {
                this.loadingOverlay.style.display = 'none';
            }

            // The logic for resetting the recovery counter remains the same and is now safe.
            if (this.currentPlayerType === 'flv') {
                this.log('FLV stream is playing, resetting recovery attempts.', 'info');
                this.recoveryAttempts = 0;
            }

            // This is now also safe, because we've already returned if an investigation was active.
            this.resetStallObservation();
        });
    }

    /**
     * Logs messages to the console and the debug UI if enabled.
     * @param {string} message - The message to log.
     * @param {('debug'|'info'|'error')} [level='info'] - The severity level of the log.
     * @param {object|null} [details=null] - Optional object with additional details for console logging.
     */
    log(message, level = "info", details = null) {
        const messageLevel = this.logLevelMap[level] ?? 1;
        if (messageLevel >= this.numericLogLevel) {
            const consoleMethod =
                {
                    debug: console.log,
                    info: console.info,
                    error: console.error,
                }[level] || console.log;
            const logPrefix = `[LivePlayer][${this.id}]`;
            if (
                level === "debug" &&
                details !== null &&
                details !== undefined
            ) {
                consoleMethod(`${logPrefix} ${message}`, details);
            } else {
                consoleMethod(`${logPrefix} ${message}`);
            }
        }
        // FIX: Use this.options.debugUI and check for logOutput's existence.
        if (this.options.debugUI && this.logOutput) {
            const now = new Date();
            const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
            const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
            this.logHistory.unshift(logEntry);
            if (this.logHistory.length > 100) this.logHistory.pop();
            this.logOutput.value = this.logHistory.join("\n"); // Use .value for <textarea>
        }
    }

    /**
     * Displays an error message in the player overlay.
     * @private
     * @param {string} message - The error message to display.
     */
    displayError(message) {
        if (this.loadingOverlay) this.loadingOverlay.style.display = "none";
        if (this.errorOverlay) {
            this.errorOverlay.textContent = message;
            this.errorOverlay.style.display = "flex";
        } else {
            this.container.innerHTML = `<div class="player-error-overlay" style="display: flex; position:relative; background: #333; color:#ffc107; padding:20px; text-align:center; justify-content:center; align-items:center;">${message}</div>`;
        }
    }

    /**
     * The central player setup dispatcher. It determines the effective stream URL based on browser
     * capabilities and the provided fallback options, then calls the appropriate setup method.
     * @private
     * @param {string} targetUrl - The user-selected, primary stream URL.
     * @param {string} [reason="unknown"] - The reason for this setup call (for logging).
     */
    setupPlayer(targetUrl, reason = "unknown") {
        this.log(`Setup requested for: ${targetUrl}, Reason: ${reason}`, "info");

        // Set the userSelectedUrl ONLY if it's a direct user action or initial load.
        // Recovery attempts should NOT change the user's original selection.
        if (!reason.endsWith('-recovery')) {
            this.userSelectedUrl = targetUrl;
        }

        // --- FIX: Reset stale content cache on every new setup ---
        // This prevents state from a previously failed stream from polluting the new one.
        this.lastKnownStaleContent = null;

        if (!targetUrl) {
            this.displayError("Setup failed: Target URL is invalid.");
            return;
        }

        // Reset the offline state before any new setup attempt. This clears
        // the offline message and stops the polling timer if it's running.
        this.clearOfflineState();

        // --- 核心回退逻辑 ---
        let urlToPlay = targetUrl;
        const lineInfo = this.streamUrlList.find(line => line.url === targetUrl);

        if (targetUrl.endsWith('.flv') && !flvjs.isSupported()) {
            this.log(`FLV stream selected, but flv.js is not supported.`, 'warn');
            if (lineInfo && lineInfo.fallback) {
                urlToPlay = lineInfo.fallback;
                this.log(`Switching to fallback URL: ${urlToPlay}`, 'info');
            } else {
                const errorMsg = 'FLV is not supported and no fallback HLS stream is available for this line.';
                this.displayError(errorMsg);
                this.log(errorMsg, 'error');
                return;
            }
        }

        // --- 统一的准备和清理工作 ---
        this.isLoading = true;
        this.loadingOverlay.style.display = "flex";
        if (this.errorOverlay) this.errorOverlay.style.display = "none";

        if (this.flvPlayer) { this.flvPlayer.destroy(); this.flvPlayer = null; }
        if (this.hlsPlayer) { this.hlsPlayer.destroy(); this.hlsPlayer = null; }
        this.video.src = '';
        this.video.removeAttribute('src');

        this.currentUrl = urlToPlay;
        this.updateActiveLineUI(targetUrl); // UI高亮用户选择的主线路

        // --- 根据最终要播放的URL进行调度 ---
        if (urlToPlay.endsWith('.m3u8')) {
            this.currentPlayerType = 'hls';
            this.setupHlsPlayer(urlToPlay, reason);
        } else if (urlToPlay.endsWith('.flv')) {
            this.currentPlayerType = 'flv';
            this.setupFlvPlayer(urlToPlay, reason);
        } else {
            const errorMsg = `Unsupported stream format for URL: ${urlToPlay}`;
            this.displayError(errorMsg);
            this.log(errorMsg, 'error');
            this.isLoading = false;
            this.loadingOverlay.style.display = "none";
        }
    }

    /**
     * Sets up the flv.js player instance for a given FLV stream URL. This method
     * is only called if flv.js is supported by the browser.
     * @private
     * @param {string} url - The FLV stream URL to play.
     * @param {string} reason - The reason for this setup call (for logging).
     */
    setupFlvPlayer(url, reason) {
        // 这个检查是多余的，因为在 setupPlayer 中已经检查过了，但保留也无妨，更安全
        if (!flvjs.isSupported()) {
            this.displayError('FLV playback is not supported in this browser.');
            this.log('flv.js is not supported, cannot play FLV stream.', 'error');
            return;
        }

        this.log(`Initializing flv.js for: ${url}`, 'debug');

        this.flvPlayer = flvjs.createPlayer({
            type: "flv",
            isLive: true,
            url: url,
        }, {
            enableStashBuffer: false
        });

        this.flvPlayer.attachMediaElement(this.video);
        this.flvPlayer.load();

        this.flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
            this.log(`flv.js runtime error: ${errorType}`, "error", { errorDetail, errorInfo });

            const httpStatus = errorInfo && errorInfo.code;

            // 我们只对网络错误进行处理
            if (errorType === flvjs.ErrorTypes.NETWORK_ERROR) {
                // --- Case 1: 主播未开播 (首次加载就遇到 404) ---
                // 这是最特殊的场景，需要立即、直接地更新UI，并停止一切后续操作。
                if (httpStatus === 404 && this.recoveryAttempts === 0) {
                    this.log('FLV stream not found (404) on initial attempt. Showing offline overlay.', 'error');

                    // 直接手动控制UI，不再调用任何复杂的处理函数
                    if (this.loadingOverlay) this.loadingOverlay.style.display = 'none';
                    if (this.offlineOverlay) this.offlineOverlay.style.display = 'flex';

                    // 停止播放器的所有活动，因为已经确定未开播
                    this.flvPlayer.unload();
                    this.flvPlayer.detachMediaElement();

                    // 手动启动后台轮询
                    this.handleOfflineState();

                    return; // *** 关键：到此为止，终止执行 ***
                }

                // --- Case 2: 所有其他网络错误 (中途断流、重试中404等) ---
                // 这些场景全部交给带重试计数器的标准错误处理器。
                this.handleStreamError(`flv-${errorDetail}`);
            }
        });

        this.flvPlayer.on(flvjs.Events.METADATA_ARRIVED, () => {
            this.log("FLV stream connected!", "info");
        });

        this.commonPlayLogic();
    }

    /**
     * Sets up the HLS player, attempting to use the browser's native HLS support first
     * (e.g., on Safari) and falling back to hls.js if necessary.
     * @private
     * @param {string} url - The HLS (.m3u8) stream URL to play.
     * @param {string} reason - The reason for this setup call (for logging).
     */
    setupHlsPlayer(url, reason) {
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) { // 原生HLS
            this.log(`Using native HLS playback for: ${url}`, 'info');
            this.video.src = url;
            this.video.addEventListener('loadedmetadata', () => {
                this.log('Native HLS stream metadata loaded.', 'info');
            }, { once: true }); // 使用 once 选项避免重复绑定
            this.commonPlayLogic();
        } else if (Hls.isSupported()) { // hls.js
            this.log(`Using hls.js for playback: ${url}`, 'info');
            const hlsConfig = this.options.liveEdge.hlsConfig || {};
            this.hlsPlayer = new Hls(hlsConfig);
            this.hlsPlayer.loadSource(url);
            this.hlsPlayer.attachMedia(this.video);

            this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                this.log('hls.js manifest parsed, stream ready.', 'info');
            });

            this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
                this.log(`hls.js error: ${data.type} - ${data.details}`, 'error', data);

                // --- PRIORITY 1: Handle the unique UI case of an initial 404 ---
                // This must be checked first for the best user experience on an offline stream.
                if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR && data.response?.code === 404 && this.recoveryAttempts === 0) {
                    this.log('HLS manifest not found (404) on initial attempt. Displaying offline overlay and starting poller.', 'error');
                    if (this.loadingOverlay) this.loadingOverlay.style.display = 'none';
                    if (this.offlineOverlay) this.offlineOverlay.style.display = 'flex';
                    this.hlsPlayer.stopLoad();
                    this.handleOfflineState();
                    return;
                }

                // --- PRIORITY 2: If we are already investigating, ignore all subsequent errors ---
                // This state lock is the key to preventing all race conditions.
                if (this.isObservingStall) {
                    this.log(`Ignoring HLS error (${data.details}) because an investigation is already in progress.`, 'debug');
                    return;
                }

                // --- PRIORITY 3: Trust hls.js on FATAL errors ---
                // If the library itself gives up after its own retries, we escalate to our recovery mechanism.
                // This handles levelLoadTimeOut, manifestLoadError, and any other future fatal errors generically.
                if (data.fatal) {
                    this.log(`A fatal HLS error occurred (${data.details}). Escalating to our recovery handler.`, 'warn');
                    this.handleStreamError(`hls-fatal-${data.details}`);
                    return;
                }

                // --- PRIORITY 4: Investigate ambiguous "soft errors" ---
                // If the error is not fatal but playback is stalled, it's time for our expert investigator to step in.
                if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
                    this.isObservingStall = true; // Set the lock
                    this.investigateHlsFailure();
                }

                // All other non-fatal errors (like bufferNudgeOnStall) are considered minor and handled internally
                // by hls.js, so we don't need to react to them.
            });

            this.commonPlayLogic();
        } else {
            this.displayError('HLS playback is not supported in this browser.');
            this.log('Neither native HLS nor hls.js are supported.', 'error');
        }
    }

    /**
     * Encapsulates the common logic for initiating video playback. It handles the play promise,
     * updates the UI state, and starts the latency monitor for FLV streams.
     * @private
     */
    commonPlayLogic() {
        this.video.muted = !this.userInteracted;
        const playPromise = this.video.play();

        if (playPromise !== undefined) {
            playPromise
                .catch((e) => {
                    this.log(`Autoplay was prevented: ${e.message}`, "warn");
                    // We DO NOT hide the loading overlay here. If autoplay is prevented,
                    // the loading overlay should remain visible until the user clicks to play,
                    // or until a stream error (like 404) is definitively handled.
                    this.updateAllUI();
                })
                .finally(() => {
                    this.isLoading = false;
                    this.updateAllUI();
                    if (this.currentPlayerType === 'flv' && this.options.liveEdge.enabled) {
                        this.startLatencyMonitor();
                    } else if (this.latencyChecker) { // 如果从FLV切换到HLS，停止旧的延迟检查
                        clearInterval(this.latencyChecker);
                        this.latencyChecker = null;
                    }
                });
        }
    }

    /** Updates all UI components to reflect the current state. @private */
    updateAllUI() {
        this.updatePlayPauseUI();
        this.updateVolumeUI();
    }

    /** Toggles between play and pause states. @private */
    togglePlay() {
        this.video.paused
            ? this.video
                .play()
                .catch((e) => this.log(`Play error: ${e.message}`, "error"))
            : this.video.pause();
    }

    /** Updates the volume slider and mute button icon. @private */
    updatePlayPauseUI() {
        const isPaused = this.video.paused;
        this.playerContainer.classList.toggle("paused", isPaused);
        if (this.playPauseBtn) {
            this.playPauseBtn.querySelector(".fa-play").style.display = isPaused
                ? "block"
                : "none";
            this.playPauseBtn.querySelector(".fa-pause").style.display =
                isPaused ? "none" : "block";
        }
    }
    updateVolumeUI() {
        if (!this.volumeSlider) return;
        const isMuted = this.video.muted || this.video.volume === 0;
        this.volumeSlider.value = isMuted ? 0 : this.video.volume;
        this.muteBtn.querySelector(".fa-volume-up").style.display = isMuted
            ? "none"
            : "inline";
        this.muteBtn.querySelector(".fa-volume-mute").style.display = isMuted
            ? "inline"
            : "none";
        this.unmuteNotice.classList.toggle(
            "visible",
            !this.userInteracted && isMuted
        );
        this.volumeContainer.classList.toggle("muted", isMuted);
    }

    /** Highlights the currently active line in the switch menu. @private */
    updateActiveLineUI(url) {
        if (this.lineSwitchMenu) {
            this.lineSwitchMenu
                .querySelector(".active")
                ?.classList.remove("active");
            const item = this.lineSwitchMenu.querySelector(
                `li[data-url="${url}"]`
            );
            if (item) item.classList.add("active");
        }
    }

    /** Switches to a new stream line. @private */
    switchLine(targetLi) {
        const newUrl = targetLi.dataset.url;
        // Compare with userSelectedUrl to prevent re-setup on the same intended line.
        if (!newUrl || (newUrl === this.userSelectedUrl && !this.isLoading)) {
            this.lineSwitchMenu.classList.remove("visible");
            return;
        }
        this.lineSwitchMenu.classList.remove("visible");
        // Switching line is a user-initiated action and should reset recovery attempts.
        this.recoveryAttempts = 0;
        // When switching line, we are setting a new user-selected URL.
        this.setupPlayer(newUrl, `manual switch to ${targetLi.textContent}`);
    }

    /** Starts the periodic check for stream latency. @private */
    startLatencyMonitor() {
        if (this.latencyChecker) clearInterval(this.latencyChecker);
        if (!this.options.liveEdge.enabled) {
            this.log('Live edge seeking is disabled by configuration.', 'info');
            return;
        }
        const { interval, maxLatency } = this.options.liveEdge;

        this.latencyChecker = setInterval(() => {
            if (!this.video.paused && !document.hidden) {
                const bufferedEnd =
                    this.video.buffered.length > 0
                        ? this.video.buffered.end(
                            this.video.buffered.length - 1
                        )
                        : 0;
                if (bufferedEnd > 0) {
                    const latency = bufferedEnd - this.video.currentTime;
                    if (latency > maxLatency) this.seekToLiveEdge();
                }
            }
        }, interval);
    }

    /** Seeks the video to the most recently buffered position. @private */
    seekToLiveEdge() {

        // 确保视频正在播放且有缓冲数据，否则无法计算延迟
        if (this.video.paused || this.video.buffered.length === 0) {
            this.log('Video is not in a state to check latency (paused or no buffer).', 'debug');
        }

        // 计算当前延迟
        const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
        const latency = bufferedEnd - this.video.currentTime;

        if (latency > this.options.liveEdge.latency) {
            this.log(`Latency (${latency.toFixed(2)}s) is greater than ${this.options.liveEdge.latency}s. Seeking to live edge.`, 'info');
            // 原有的seek代码
            if (this.video.buffered.length > 0) {
                // --- MODIFIED: 在寻址前显示加载动画 ---
                this.log('Seeking to live edge, showing loading overlay.', 'info');
                if (this.loadingOverlay) {
                    // 复用已有的加载动画
                    this.loadingOverlay.style.display = 'flex';
                }
                const liveEdge = this.video.buffered.end(
                    this.video.buffered.length - 1
                );
                // 执行寻址操作，完成后 'seeked' 事件会触发并隐藏加载动画
                this.video.currentTime = liveEdge - 0.1;
            } else {
                this.log('Cannot seek to live edge, no buffer available.', 'warn');
            }
        } else {
            this.log(`Latency (${latency.toFixed(2)}s) is acceptable. No seek needed.`, 'info');
        }
    }

    /**
     * Handles browser tab visibility changes to ensure continuous playback.
     * When the tab becomes hidden, it does nothing to interrupt playback.
     * When the tab becomes visible again, it checks for latency and seeks to the live edge if needed.
     * @private
     */
    handleVisibilityChange() {
        if (document.hidden) {
            // --- 关键：当页面隐藏时，我们什么都不做 ---
            // 不要暂停视频，不要静音，让它继续尝试播放。
            // 浏览器自身的节流机制仍然会起作用，但我们不主动干预。
            this.log('Tab is now hidden, attempting to continue playback in the background.', 'info');
        } else {
            // --- 当页面恢复可见时 ---
            this.log('Tab is visible again.', 'info');

            // 1. 检查视频是否意外暂停了
            if (this.video.paused && this.userInteracted) {
                this.log('Video was paused in background, attempting to resume.', 'warn');
                this.video.play().catch(e => this.log(`Error resuming playback: ${e.message}`, 'error'));
            }

            // 2. 检查延迟，因为后台播放可能会导致延迟累积
            // 延迟一下再检查，给播放器一点时间恢复状态
            setTimeout(() => {
                this.log('Checking latency after returning from background...', 'info');
                this.seekToLiveEdge();
            }, 1000); // 1秒后检查
        }
    }

    /** Toggles Picture-in-Picture mode. @private */
    togglePip() {
        document.pictureInPictureElement
            ? document.exitPictureInPicture()
            : this.video.requestPictureInPicture();
    }

    /** Toggles fullscreen mode. @private */
    toggleFullscreen() {
        document.fullscreenElement
            ? document.exitFullscreen()
            : this.playerContainer.requestFullscreen();
    }

    /** Updates UI based on fullscreen state. @private */
    updateFullscreenUI() {
        this.playerContainer.classList.toggle(
            "fullscreen",
            !!document.fullscreenElement
        );
    }

    /** Shows the player controls and sets a timeout to hide them. @private */
    showControls() {
        if (this.controls) this.controls.classList.add("visible");
        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = setTimeout(() => {
            if (!this.video.paused) this.controls.classList.remove("visible");
        }, 3000);
    }

    /** Hides the controls immediately when the mouse leaves the player. @private */
    hideControlsOnLeave() {
        clearTimeout(this.controlsTimeout);
        if (!this.video.paused && this.controls)
            this.controls.classList.remove("visible");
    }

    /**
     * @private
     * Normalizes an M3U8 playlist content by removing query strings from .ts segment URLs.
     * This is crucial for comparing playlists when server-side caches might alter query params
     * without changing the actual underlying (stale) TS file.
     * @param {string | null} m3u8Content The raw M3U8 content.
     * @returns {string | null} The normalized M3U8 content or null if input was null.
     */
    normalizeM3u8Content(m3u8Content) {
        if (!m3u8Content) {
            return null;
        }
        // This regex finds all lines ending in '.ts?....' and replaces them with just '.ts'
        // 'g' flag for global replace, 'm' flag for multiline mode (so '$' matches end of line)
        return m3u8Content.replace(/\.ts\?.*$/gm, '.ts');
    }

    /**
     * Handles the "stream offline" scenario. It initiates a silent polling
     * mechanism using fetch() that does not interfere with the UI until the
     * stream is confirmed to be back online.
     * Implements the "intelligent polling" strategy.
     * It now fetches the actual media playlist and compares its content against
     * the last known stale content before deciding if the stream is truly back online.
     * @private
     */
    handleOfflineState() {
        if (this.offlinePoller) {
            clearInterval(this.offlinePoller);
        }

        this.offlinePoller = setInterval(async () => {
            const masterUrl = this.userSelectedUrl;
            if (!masterUrl) {
                this.log('Could not find user-selected URL to poll, stopping poller.', 'error');
                this.clearOfflineState();
                return;
            }

            // This intelligent logic is for HLS only.
            if (!masterUrl.endsWith('.m3u8')) {
                // For FLV, just do a simple HEAD request.
                this.log(`Polling for user-selected FLV stream silently: ${masterUrl}`, 'debug');
                try {
                    const response = await fetch(masterUrl, { method: 'HEAD', cache: 'no-cache' });
                    if (response.ok) {
                        this.log('Stream is back online! Re-initializing player.', 'info');
                        this.clearOfflineState();
                        this.setupPlayer(masterUrl, 'offline-poll-success');
                    }
                } catch (error) { /* Do nothing on network error */ }
                return;
            }

            this.log(`Intelligently polling HLS stream: ${masterUrl}`, 'debug');

            try {
                // Step 1: Fetch the master playlist to get the current media playlist URL.
                const masterResponse = await fetch(masterUrl, { cache: 'no-cache' });
                if (!masterResponse.ok) return;
                const masterContent = await masterResponse.text();

                // A very basic parser to find the first non-comment line (the media playlist URI)
                const mediaPlaylistUri = masterContent.split('\n').find(line => line.trim() && !line.startsWith('#'));
                if (!mediaPlaylistUri) return;

                // Handle both relative and absolute URIs in the master playlist
                const mediaPlaylistUrl = new URL(mediaPlaylistUri, masterUrl).href;

                // Step 2: Fetch the actual media playlist.
                const mediaResponse = await fetch(mediaPlaylistUrl, { cache: 'no-cache' });
                if (!mediaResponse.ok) return;
                const mediaContent = await mediaResponse.text();

                // Normalize content before comparison
                const normalizedMediaContent = this.normalizeM3u8Content(mediaContent);
                const normalizedStaleContent = this.normalizeM3u8Content(this.lastKnownStaleContent);

                // Enhanced debug logging to show both raw and normalized versions
                this.log('--- M3U8 Comparison Debug ---', 'debug');
                this.log('Stored (stale) RAW m3u8:', 'debug', { content: this.lastKnownStaleContent });
                this.log('Fetched (current) RAW m3u8:', 'debug', { content: mediaContent });
                this.log('Stored (stale) NORMALIZED m3u8:', 'debug', { content: normalizedStaleContent });
                this.log('Fetched (current) NORMALIZED m3u8:', 'debug', { content: normalizedMediaContent });
                this.log('--- End Comparison Debug ---', 'debug');

                // Step 3: Compare its content with the last known stale content.
                // The comparison now uses the normalized (parameter-free) content
                if (this.lastKnownStaleContent && normalizedMediaContent === normalizedStaleContent) {
                    // It's still the same old, dead playlist. Do nothing and wait.
                    this.log('Poll check: HLS media playlist is still stale.', 'debug');
                } else {
                    // It's different! This means the stream is genuinely new or has been revived.
                    this.log('Stream is back online! HLS media playlist has changed.', 'info');
                    this.clearOfflineState();
                    this.lastKnownStaleContent = null; // Clear the cache
                    // Show loading animation and setup the player.
                    this.loadingOverlay.style.display = 'flex';
                    this.offlineOverlay.style.display = 'none';
                    this.setupPlayer(masterUrl, 'offline-poll-success');
                }
            } catch (error) {
                this.log(`Poll check: Network error during intelligent poll. ${error.message}`, 'warn');
            }
        }, this.offlinePollInterval);
    }

    /**
     * Clears any "stream offline" state, hiding the overlay and stopping the poller.
     * This is called at the beginning of every `setupPlayer` call.
     * @private
     */
    clearOfflineState() {
        if (this.offlinePoller) {
            clearInterval(this.offlinePoller);
            this.offlinePoller = null;
        }
        if (this.offlineOverlay) {
            this.offlineOverlay.style.display = 'none';
        }
    }

    /**
     * @private
     * Initiates a check to see if the HLS manifest (m3u8) is still being updated.
     * This is the most reliable way to differentiate a network stall from a true "stream ended" event.
     * It programmatically checks for a stale manifest multiple times without relying on
     * a full player reconnect loop. This is the definitive solution to the "ghost-play" loop.
     */
    async investigateHlsFailure() {
        this.log('Severe HLS error detected. Initiating failure investigation sequence.', 'warn');

        try {
            if (!this.hlsPlayer || !this.hlsPlayer.levels || this.hlsPlayer.currentLevel < 0) {
                throw new Error('HLS player or its active level is not ready.');
            }

            const mediaPlaylistUrl = this.hlsPlayer.levels[this.hlsPlayer.currentLevel].url;
            const MAX_CHECKS = 3;
            const CHECK_INTERVAL = 1500;
            let lastFetchedRawContent = ''; // Store the raw content of the playlist for the final cache

            for (let i = 1; i <= MAX_CHECKS; i++) {
                if (!this.isObservingStall) {
                    this.log('HLS investigation was cancelled externally.', 'info');
                    return; // Investigation cancelled
                }

                try {
                    const response = await fetch(mediaPlaylistUrl, { cache: 'no-cache' });
                    if (!response.ok) throw new Error(`HTTP Status ${response.status}`);
                    const currentFetchedRawContent = await response.text();

                    // On the second check and onwards, compare the new playlist with the last one
                    if (i > 1) {
                        // --- FIX: Compare NORMALIZED content to defeat caching issues ---
                        const lastNormalized = this.normalizeM3u8Content(lastFetchedRawContent);
                        const currentNormalized = this.normalizeM3u8Content(currentFetchedRawContent);

                        if (currentNormalized !== lastNormalized) {
                            // SUCCESS: The playlist content has actually changed. The stream is alive.
                            this.log(`HLS media playlist updated on check ${i}/${MAX_CHECKS}. Stream is healthy.`, 'info');
                            this.recoveryAttempts = 0; // Reset main error counter
                            return; // Exit the investigation successfully
                        }
                    }

                    // For the next loop, the "current" content becomes the "last" content
                    lastFetchedRawContent = currentFetchedRawContent;
                    this.log(`HLS investigation check ${i}/${MAX_CHECKS}: Playlist is stale.`, 'debug');

                } catch (error) {
                    this.log(`Network error during HLS investigation check ${i}/${MAX_CHECKS}: ${error.message}.`, 'warn');
                }

                if (i < MAX_CHECKS) await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
            }

            // FAILURE: All checks completed, and the normalized playlist never changed.
            this.log(`HLS stream failed ${MAX_CHECKS} consecutive checks. Declaring stream offline.`, 'error');
            // Cache the raw content of the stale playlist we last fetched.
            this.lastKnownStaleContent = lastFetchedRawContent;
            this.recoveryAttempts = this.maxRecoveryAttempts; // Set to max to trigger offline declaration
            this.handleStreamError('hls-investigation-failed');

        } catch (error) {
            // Catch errors from the initial setup (e.g., player not ready)
            this.log(`HLS investigation could not start: ${error.message}`, 'error');
            this.handleStreamError('hls-investigation-setup-failed');
        } finally {
            // CRUCIAL: ALWAYS release the lock when the investigation is over.
            this.log('HLS investigation finished. Releasing lock.', 'debug');
            this.isObservingStall = false;
        }
    }

    /**
     * @private
     * Resets all states related to the stall observation process.
     */
    resetStallObservation() {
        if (this.stallObserverTimer) {
            clearTimeout(this.stallObserverTimer);
            this.stallObserverTimer = null;
        }
        this.isObservingStall = false;
    }

    /**
     * @private
     * Unified handler for recoverable stream errors like Early-EOF or stale HLS manifest.
     * Manages the recovery attempt counter and decides when to give up.
     * @param {string} reason - A short string indicating the error reason for logging.
     */
    handleStreamError(reason) {
        this.recoveryAttempts++;
        this.log(`Recoverable stream error detected (${reason}). Attempt: ${this.recoveryAttempts}`, 'warn');

        // Always reset stall observation state after a confirmed check
        this.resetStallObservation();

        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
            this.log(`Recovery threshold reached for ${reason}. Declaring stream offline.`, 'error');
            this.declareStreamOffline();
        } else {
            this.log(`Attempting a quick reconnect...`, 'info');
            // Use a reason suffix to distinguish from user-initiated actions in logs
            setTimeout(() => this.setupPlayer(this.currentUrl, `${reason}-recovery`), 1500);
        }
    }

    /**
     * @private
     * A unified method to perform all actions when a stream is confirmed to be offline.
     */
    declareStreamOffline() {
        // Step 1: Stop any active player instances without destroying the component.
        if (this.flvPlayer) {
            this.flvPlayer.unload();
            this.flvPlayer.detachMediaElement();
        }
        if (this.hlsPlayer) {
            this.video.src = '';
            this.video.removeAttribute('src');
            this.hlsPlayer.stopLoad();
        }

        // Step 2: Update the UI to show the offline state.
        // Because we didn't destroy(), the elements are still here to be shown.
        if (this.loadingOverlay) this.loadingOverlay.style.display = 'none';
        if (this.offlineOverlay) this.offlineOverlay.style.display = 'flex';

        // Step 3: Reset the recovery counter so that a manual refresh starts cleanly.
        this.recoveryAttempts = 0;

        // Step 4: Start the background polling to detect when the stream comes back online.
        this.handleOfflineState();
    }

}
