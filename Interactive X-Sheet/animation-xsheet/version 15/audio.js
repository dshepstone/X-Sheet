//--- START OF FILE audio.js ---

/**
 * audio.js - Audio processing and waveform visualization
 * Handles audio loading, playback, and waveform visualization for the X‑Sheet
 *
 * 2025‑05‑09 — continuous‑scrub update patch
 *   • Adds live scrubbing while dragging
 *   • Properly registers / removes document‑level listeners
 *   • Throttles scrub‑preview playback to avoid audio spam
 */

window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Audio = window.XSheetApp.Audio || {};

(function (app) {
    'use strict';

    /* ------------------------------------------------------------------ *
     *  State & globals
     * ------------------------------------------------------------------ */

    const state = {
        audioContext: null,
        audioBuffer: null,
        audioSource: null,
        audioData: null,             // (unused – kept for possible future use)
        isPlaying: false,
        startTime: 0,
        startOffset: 0,
        audioFileName: '',
        waveformData: [],
        phonetics: [],
        frameDuration: 1 / 24,       // 24 fps
        currentFrame: 0,
        phoneticEditPosition: null
    };

    // DOM cache
    let elements = {};

    // Active overlay container (one per sheet)
    let activeWaveformContainer = null;

    /* ----------  NEW ­(scrub listeners / throttle helpers) ---------- */

    // Current document‑level handlers so we can detach them later
    let boundHandleScrubMove = null;
    let boundHandleScrubEnd = null;

    // Throttle variables for scrub audio preview
    let lastScrubPlayTime = 0;
    const scrubThrottleDelay = 50;   // ms – tweak 30‑60 ms for responsiveness vs. spam

    /* ------------------------------------------------------------------ *
     *  Initialisation / element cache / high‑level app hooks
     * ------------------------------------------------------------------ */

    function init() {
        cacheElements();
        setupEventListeners();
        listenForAppEvents();

        // Keep overlay aligned on scroll / resize
        window.addEventListener('scroll', requestUpdateWaveformOverlayPosition, { passive: true });
        window.addEventListener('resize', requestUpdateWaveformOverlayPosition, { passive: true });
    }

    function cacheElements() {
        elements = {
            audioButton: document.getElementById('audio-button'),
            audioUpload: document.getElementById('audio-upload'),
            playAudioButton: document.getElementById('play-audio'),
            stopAudioButton: document.getElementById('stop-audio'),
            audioScrubber: document.getElementById('audio-scrubber'),
            audioInfo: document.getElementById('audio-info'),
            addPhoneticButton: document.getElementById('add-phonetic'),
            phoneticInput: document.getElementById('phonetic-input'),
            phoneticText: document.getElementById('phonetic-text'),
            savePhoneticButton: document.getElementById('save-phonetic'),
            cancelPhoneticButton: document.getElementById('cancel-phonetic')
        };
    }

    function setupEventListeners() {
        elements.audioButton.addEventListener('click', () => elements.audioUpload.click());

        elements.audioUpload.addEventListener('change', (e) => {
            if (e.target.files.length) {
                const file = e.target.files[0];
                state.audioFileName = file.name;
                loadAudioFile(file);
            }
        });

        elements.playAudioButton.addEventListener('click', togglePlayAudio);
        elements.stopAudioButton.addEventListener('click', stopAudio);
        elements.audioScrubber.addEventListener('input', scrubAudio);

        elements.addPhoneticButton.addEventListener('click', () => {
            if (state.audioBuffer) showPhoneticInput(null);
            else app.updateStatusMessage('Please load audio first');
        });

        elements.savePhoneticButton.addEventListener('click', savePhoneticMarker);
        elements.cancelPhoneticButton.addEventListener('click', () => {
            elements.phoneticInput.style.display = 'none';
        });
    }

    function listenForAppEvents() {
        document.addEventListener('xsheet-updated', () => state.audioBuffer && renderWaveform());
        document.addEventListener('xsheet-framecount-changed', () => state.audioBuffer && renderWaveform());
        document.addEventListener('xsheet-template-changed', () => state.audioBuffer && renderWaveform());

        document.addEventListener('xsheet-clear', () => {
            state.audioBuffer = null;
            state.audioSource = null;
            state.waveformData = [];
            state.phonetics = [];
            state.audioFileName = '';
            elements.audioInfo.textContent = 'No audio loaded';

            stopAudio();
            removeScrubListeners();                      //  ← NEW
            if (activeWaveformContainer) {
                activeWaveformContainer.remove();
                activeWaveformContainer = null;
            }
        });

        document.addEventListener('xsheet-collect-data', (e) => {
            if (e.detail?.data) {
                e.detail.data.audio = {
                    fileName: state.audioFileName,
                    phonetics: state.phonetics
                };
            }
        });

        document.addEventListener('xsheet-restore-data', (e) => {
            if (e.detail?.data?.audio) {
                state.audioFileName = e.detail.data.audio.fileName || '';
                state.phonetics = e.detail.data.audio.phonetics || [];

                if (state.audioBuffer && state.phonetics.length) {
                    renderWaveform();
                } else if (state.audioFileName && state.phonetics.length) {
                    elements.audioInfo.textContent =
                        `Audio: ${state.audioFileName} (markers loaded, file not present)`;
                }
            }
        });
    }

    /* ------------------------------------------------------------------ *
     *  Audio file handling
     * ------------------------------------------------------------------ */

    function loadAudioFile(file) {
        if (!state.audioContext) {
            try {
                window.AudioContext = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioContext();
            } catch (err) {
                app.updateStatusMessage('Web Audio API is not supported in this browser');
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = (eReader) => {
            app.updateStatusMessage('Decoding audio…');
            state.audioContext.decodeAudioData(
                eReader.target.result,
                (buffer) => {
                    state.audioBuffer = buffer;

                    const duration = buffer.duration;
                    const minutes = Math.floor(duration / 60);
                    const seconds = Math.floor(duration % 60);
                    const frameCount = Math.ceil(duration * 24);

                    elements.audioInfo.textContent =
                        `${state.audioFileName} (${minutes}:${seconds.toString().padStart(2, '0')}, `
                        + `${frameCount} frames @ 24 fps)`;
                    elements.playAudioButton.disabled = false;
                    elements.stopAudioButton.disabled = false;
                    elements.audioScrubber.disabled = false;

                    generateWaveformData(buffer);
                    app.updateStatusMessage(`Audio loaded: ${state.audioFileName}`);

                    if (app.state && frameCount > app.state.frameCount) {
                        if (confirm(
                            `This audio is ${frameCount} frames long at 24 fps, `
                            + `but your X‑sheet only has ${app.state.frameCount} frames. `
                            + `Increase the X‑sheet frame count?`
                        )) {
                            app.state.frameCount = frameCount;
                            document.getElementById('frame-count').value = frameCount;
                            if (app.generateTable) app.generateTable(frameCount);
                            else renderWaveform();
                        } else {
                            renderWaveform();
                        }
                    } else {
                        renderWaveform();
                    }
                },
                (errDecode) => {
                    console.error('Audio decoding error:', errDecode);
                    app.updateStatusMessage(
                        'Error decoding audio: ' + (errDecode.message || 'Format may be unsupported')
                    );
                }
            );
        };
        reader.onerror = () => app.updateStatusMessage('Error reading audio file');
        reader.readAsArrayBuffer(file);
    }

    function generateWaveformData(buffer) {
        const rawData = buffer.getChannelData(0);
        const totalSamples = rawData.length;
        state.waveformData = [];

        const pointsPerSecond = 100;
        const totalPoints = Math.ceil(buffer.duration * pointsPerSecond);
        const step = Math.floor(totalSamples / totalPoints);

        for (let i = 0; i < totalPoints; i++) {
            const index = i * step;
            if (index < totalSamples) state.waveformData.push(Math.abs(rawData[index]));
        }
    }

    /* ------------------------------------------------------------------ *
     *  Waveform drawing helpers
     * ------------------------------------------------------------------ */

    function drawWaveformOnCanvas(canvas, waveData, audioDuration) {
        if (!canvas || !waveData.length) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255,255,255,.8)';   // semi‑transparent white behind waveform
        ctx.fillRect(0, 0, width, height);

        // centre line
        ctx.beginPath();
        ctx.strokeStyle = '#ccc';
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        /* --- outline waveform --- */

        ctx.beginPath();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;

        for (let i = 0; i < waveData.length; i++) {
            const y = (i / waveData.length) * height;
            const amplitude = waveData[i] * (width * 0.4);
            const x = (width / 2) + amplitude;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        for (let i = waveData.length - 1; i >= 0; i--) {
            const y = (i / waveData.length) * height;
            const amplitude = waveData[i] * (width * 0.4);
            const x = (width / 2) - amplitude;
            ctx.lineTo(x, y);
        }
        ctx.stroke();

        /* --- horizontal tick marks every 8 / 24 frames --- */

        const xsheetTableBody = document.getElementById('xsheet-body');
        if (!xsheetTableBody) return;

        const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length;
        const framesPerSecond = 24;
        const totalAudioFrames = Math.ceil(audioDuration * framesPerSecond);

        for (let i = 1; i <= totalAudioFrames && i <= totalRows; i++) {
            const yPos = (i / totalRows) * height;

            if (i % 8 === 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#999';
                ctx.lineWidth = (i % 24 === 0) ? 2 : 1;
                ctx.moveTo(0, yPos);
                ctx.lineTo(width, yPos);
                ctx.stroke();
            }
        }
    }

    /* ------------------------------------------------------------------ *
     *  Main overlay render / positioning
     * ------------------------------------------------------------------ */

    function renderWaveform() {
        if (!state.audioBuffer || !state.waveformData.length) return;
        console.log('Rendering waveform overlay…');

        /* ----- ensure previous overlay & listeners are cleaned‑up ----- */
        removeScrubListeners();                    //  ← NEW

        if (activeWaveformContainer) activeWaveformContainer.remove();

        /* ----- create new overlay elements ----- */

        const table = document.getElementById('xsheet-table');
        const firstCell = table?.querySelector('.waveform-col[data-frame="1"]');
        if (!firstCell) return;

        const xsheetBody = document.getElementById('xsheet-body');
        if (!xsheetBody) return;
        const totalRows = xsheetBody.querySelectorAll('tr[data-frame]').length;

        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;

        // container
        const container = document.createElement('div');
        container.className = 'waveform-container';
        container.style.position = 'absolute';
        container.style.zIndex = '4';
        container.style.pointerEvents = 'none';

        // canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'waveform-canvas';
        canvas.width = firstCell.offsetWidth;
        canvas.height = totalHeight;
        container.appendChild(canvas);

        // click/scrub overlay
        const overlay = document.createElement('div');
        overlay.className = 'waveform-overlay';
        overlay.style.height = totalHeight + 'px';
        container.appendChild(overlay);

        /* ------------------------------------------------------------- *
         *  Overlay interaction: click / scrub
         * ------------------------------------------------------------- */

        // Click quick‑seek
        overlay.addEventListener('click', (e) => {
            if (!state.audioBuffer) return;

            const rect = overlay.getBoundingClientRect();
            const percentage = (e.clientY - rect.top) / rect.height;
            const timePoint = percentage * state.audioBuffer.duration;

            elements.audioScrubber.value = percentage * 100;
            state.startOffset = timePoint;

            if (state.isPlaying) {
                stopAudio();
                playAudio();
            }
            updateFrameMarker();
        });

        /* ---- continuous scrub (mousedown / pointerdown) ---- */

        let isScrubbing = false;
        const scrubOverlay = overlay;    // alias for handlers
        overlay.addEventListener('mousedown', (e) => {
            if (!state.audioBuffer || e.button !== 0) return;
            isScrubbing = true;
            if (state.isPlaying) pauseAudio();
            if (!state.audioContext) return;
            updateScrubPosition(e, scrubOverlay);
            e.preventDefault();
        });

        overlay.addEventListener('pointerdown', (e) => {
            if (!state.audioBuffer || (e.pointerType !== 'pen' && e.button !== 0)) return;
            isScrubbing = true;
            if (state.isPlaying) pauseAudio();
            if (!state.audioContext) return;
            try { scrubOverlay.setPointerCapture(e.pointerId); }
            catch (err) { console.warn('Pointer capture failed:', err); }
            updateScrubPosition(e, scrubOverlay);
            e.preventDefault();
        });

        /* ----- document‑level move & end handlers (NEW) ----- */

        boundHandleScrubMove = (e) => {
            if (!isScrubbing || !state.audioBuffer) return;
            if (e.pointerType === 'mouse' && e.buttons !== 1) {
                // mouse button released without triggering mouseup
                boundHandleScrubEnd(e);
                return;
            }
            updateScrubPosition(e, scrubOverlay);
        };

        boundHandleScrubEnd = (e) => {
            if (!isScrubbing) return;
            if (e.type === 'mouseup' && e.button !== 0) return;

            isScrubbing = false;

            if (e.pointerId && scrubOverlay.hasPointerCapture(e.pointerId)) {
                try { scrubOverlay.releasePointerCapture(e.pointerId); }
                catch (err) { console.warn('Release pointer capture failed:', err); }
            }

            if (scrubSource) {
                try { scrubSource.stop(); }
                catch (err) {/* ignore */ }
                scrubSource = null;
            }
        };

        document.addEventListener('mousemove', boundHandleScrubMove);
        document.addEventListener('pointermove', boundHandleScrubMove);
        document.addEventListener('mouseup', boundHandleScrubEnd);
        document.addEventListener('pointerup', boundHandleScrubEnd);
        console.log('Scrub: Document listeners attached.');

        /* ------------------------------------------------------------- */

        // add container to DOM
        const printableArea = document.getElementById('printable-area');
        (printableArea || document.body).appendChild(container);
        activeWaveformContainer = container;

        // initial position & drawing
        updateWaveformOverlayPosition();
        drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
        renderPhoneticMarkers();
        updateFrameMarker();
    }

    /* ------------------------------------------------------------------ *
     *  Remove document‑level scrub listeners (NEW helper)
     * ------------------------------------------------------------------ */

    function removeScrubListeners() {
        if (boundHandleScrubMove) {
            document.removeEventListener('mousemove', boundHandleScrubMove);
            document.removeEventListener('pointermove', boundHandleScrubMove);
            boundHandleScrubMove = null;
        }
        if (boundHandleScrubEnd) {
            document.removeEventListener('mouseup', boundHandleScrubEnd);
            document.removeEventListener('pointerup', boundHandleScrubEnd);
            boundHandleScrubEnd = null;
        }
        console.log('Scrub: Document listeners removed.');
    }

    /* ------------------------------------------------------------------ *
     *  Overlay position maintenance
     * ------------------------------------------------------------------ */

    let updatePositionRAFHandle = null;

    function requestUpdateWaveformOverlayPosition() {
        if (updatePositionRAFHandle) cancelAnimationFrame(updatePositionRAFHandle);
        updatePositionRAFHandle = requestAnimationFrame(updateWaveformOverlayPosition);
    }

    function updateWaveformOverlayPosition() {
        if (!activeWaveformContainer || !state.audioBuffer) return;
        updatePositionRAFHandle = null;

        const table = document.getElementById('xsheet-table');
        const firstCell = table?.querySelector('.waveform-col[data-frame="1"]');
        if (!table || !firstCell) {
            activeWaveformContainer.style.display = 'none';
            console.warn('Waveform overlay: table or first cell not found.');
            return;
        }

        if (firstCell.offsetWidth === 0 || firstCell.offsetHeight === 0) {
            activeWaveformContainer.style.display = 'none';
            console.warn('Waveform overlay: firstCell has zero dimensions.');
            return;
        }
        activeWaveformContainer.style.display = 'block';

        const cellRect = firstCell.getBoundingClientRect();
        const xsheetBody = document.getElementById('xsheet-body');
        const totalRows = xsheetBody?.querySelectorAll('tr[data-frame]').length || 0;
        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;

        const absoluteCellLeft = cellRect.left + window.scrollX;
        const absoluteCellTop = cellRect.top + window.scrollY;

        let posChanged = false;
        let sizeChanged = false;

        const targetLeft = absoluteCellLeft - 1;
        const targetTop = absoluteCellTop;

        if (Math.abs((parseFloat(activeWaveformContainer.style.left) || 0) - targetLeft) > 0.5) {
            activeWaveformContainer.style.left = targetLeft + 'px';
            posChanged = true;
        }
        if (Math.abs((parseFloat(activeWaveformContainer.style.top) || 0) - targetTop) > 0.5) {
            activeWaveformContainer.style.top = targetTop + 'px';
            posChanged = true;
        }

        if (activeWaveformContainer.style.width !== cellRect.width + 'px') {
            activeWaveformContainer.style.width = cellRect.width + 'px';
            sizeChanged = true;
        }
        if (activeWaveformContainer.style.height !== totalHeight + 'px') {
            activeWaveformContainer.style.height = totalHeight + 'px';
            sizeChanged = true;
        }

        const canvas = activeWaveformContainer.querySelector('.waveform-canvas');
        const overlay = activeWaveformContainer.querySelector('.waveform-overlay');
        let canvasResized = false;

        if (canvas && (canvas.width !== cellRect.width || canvas.height !== totalHeight)) {
            canvas.width = cellRect.width;
            canvas.height = totalHeight;
            canvasResized = true;
        }
        if (overlay && sizeChanged) overlay.style.height = totalHeight + 'px';

        if (canvasResized && canvas) {
            drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
        }
        if (posChanged || sizeChanged) {
            renderPhoneticMarkers();
            updateFrameMarker();
        }
    }

    /* ------------------------------------------------------------------ *
     *  Scrub helpers (with audio‑preview throttling)
     * ------------------------------------------------------------------ */

    function updateScrubPosition(e, overlayElement) {
        const rect = overlayElement.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const percentage = Math.max(0, Math.min(1, y / rect.height));
        const timePoint = percentage * state.audioBuffer.duration;

        state.startOffset = timePoint;
        elements.audioScrubber.value = percentage * 100;

        // play scrub audio, throttled
        const now = Date.now();
        if (now - lastScrubPlayTime > scrubThrottleDelay) {
            playScrubAudio(timePoint);
            lastScrubPlayTime = now;
        }
        updateFrameMarker();
    }

    let scrubSource = null;   // per‑scrub short preview node

    function playScrubAudio(timePoint) {
        if (scrubSource) {
            try { scrubSource.stop(); } catch (err) {/* ignore */ }
            scrubSource = null;
        }
        if (!state.audioContext || !state.audioBuffer) return;

        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume().catch(err => console.error('Resume AudioContext error:', err));
            if (state.audioContext.state !== 'running') return;
        }

        scrubSource = state.audioContext.createBufferSource();
        scrubSource.buffer = state.audioBuffer;

        const gainNode = state.audioContext.createGain();
        gainNode.gain.setValueAtTime(0.8, state.audioContext.currentTime);

        scrubSource.connect(gainNode);
        gainNode.connect(state.audioContext.destination);

        const snippetDuration = 1 / 15;     // ~66 ms

        try {
            scrubSource.start(0, timePoint, snippetDuration);
            scrubSource.onended = () => {
                if (scrubSource) {
                    scrubSource.disconnect();
                    gainNode.disconnect();
                    scrubSource = null;
                }
            };
        } catch (err) {
            console.warn('Scrub audio start error:', err.message);
            scrubSource?.disconnect();
            gainNode.disconnect();
            scrubSource = null;
        }
    }

    /* ------------------------------------------------------------------ *
     *  Phonetic markers & frame marker
     * ------------------------------------------------------------------ */

    function renderPhoneticMarkers() {
        if (!activeWaveformContainer || !state.phonetics.length || !state.audioBuffer) return;

        activeWaveformContainer.querySelectorAll('.phonetic-label').forEach(el => el.remove());
        const h = activeWaveformContainer.offsetHeight;

        state.phonetics.forEach((ph, idx) => {
            const percentage = ph.time / state.audioBuffer.duration;
            const y = percentage * h;

            const label = document.createElement('div');
            label.className = 'phonetic-label';
            label.textContent = ph.text;
            label.style.position = 'absolute';
            label.style.left = '2px';
            label.style.top = Math.max(0, Math.min(y, h - 12)) + 'px';
            label.style.zIndex = '25';

            label.addEventListener('dblclick', () => showPhoneticInput(ph.time, ph.text, idx));
            activeWaveformContainer.appendChild(label);
        });
    }

    function updateFrameMarker() {
        if (!activeWaveformContainer || !state.audioBuffer) return;

        activeWaveformContainer.querySelectorAll('.waveform-marker').forEach(el => el.remove());

        const time = state.isPlaying
            ? (state.audioContext.currentTime - state.startTime + state.startOffset)
            : state.startOffset;

        const frame = Math.floor(time / state.frameDuration) + 1;
        state.currentFrame = frame;

        const h = activeWaveformContainer.offsetHeight;
        const y = Math.max(0, Math.min((time / state.audioBuffer.duration) * h, h));

        const marker = document.createElement('div');
        marker.className = 'waveform-marker';
        Object.assign(marker.style, {
            position: 'absolute',
            top: y + 'px',
            left: '0',
            width: '100%',
            height: '2px',
            backgroundColor: 'rgba(255,0,0,.7)',
            zIndex: '30',
            lineHeight: '0',
            textAlign: 'right',
            color: 'red',
            fontWeight: 'bold',
            fontSize: '8pt'
        });
        marker.textContent = `Frame ${frame}`;
        activeWaveformContainer.appendChild(marker);

        if (state.isPlaying) {
            const tableRect = document.getElementById('xsheet-table')?.getBoundingClientRect();
            const markerAbsY = activeWaveformContainer.getBoundingClientRect().top + y;

            if (tableRect && (markerAbsY < tableRect.top || markerAbsY > tableRect.bottom)) {
                const scrollTargetY = window.scrollY + markerAbsY - (window.innerHeight / 2);
                window.scrollTo({ top: scrollTargetY, behavior: 'smooth' });
            }
            requestAnimationFrame(updateFrameMarker);
        }
        elements.audioScrubber.value = (time / state.audioBuffer.duration) * 100;
    }

    /* ------------------------------------------------------------------ *
     *  Transport controls
     * ------------------------------------------------------------------ */

    function togglePlayAudio() {
        if (!state.audioContext && state.audioBuffer) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (state.audioContext?.state === 'suspended') state.audioContext.resume();

        state.isPlaying ? pauseAudio() : playAudio();
    }

    function playAudio() {
        if (!state.audioBuffer || !state.audioContext) return;

        state.audioSource = state.audioContext.createBufferSource();
        state.audioSource.buffer = state.audioBuffer;
        state.audioSource.connect(state.audioContext.destination);

        state.startTime = state.audioContext.currentTime;
        state.audioSource.start(0, state.startOffset % state.audioBuffer.duration);

        state.isPlaying = true;
        elements.playAudioButton.textContent = 'Pause';

        state.audioSource.onended = () => {
            if (state.isPlaying) stopAudio();
        };
        updateFrameMarker();
    }

    function pauseAudio() {
        if (!state.isPlaying || !state.audioSource) return;
        state.audioSource.stop();
        state.startOffset += state.audioContext.currentTime - state.startTime;
        state.isPlaying = false;
        elements.playAudioButton.textContent = 'Play';
    }

    function stopAudio() {
        if (state.audioSource) {
            try { state.audioSource.stop(); } catch (err) {/* ignore */ }
        }
        state.isPlaying = false;
        state.startOffset = 0;
        elements.playAudioButton.textContent = 'Play';
        elements.audioScrubber.value = 0;
        updateFrameMarker();
    }

    function scrubAudio() {
        if (!state.audioBuffer) return;
        const percentage = elements.audioScrubber.value / 100;
        const newTime = percentage * state.audioBuffer.duration;

        state.startOffset = newTime;
        if (state.isPlaying) {
            pauseAudio();
            playAudio();
        } else {
            updateFrameMarker();
        }
    }

    /* ------------------------------------------------------------------ *
     *  Phonetic input
     * ------------------------------------------------------------------ */

    function showPhoneticInput(time, initialText = '', editIndex = -1) {
        if (time === null) {
            time = state.isPlaying
                ? (state.audioContext.currentTime - state.startTime + state.startOffset)
                : state.startOffset;
        }
        state.phoneticEditPosition = { time, editIndex };
        elements.phoneticText.value = initialText;

        if (activeWaveformContainer) {
            const rect = activeWaveformContainer.getBoundingClientRect();
            const percentage = time / state.audioBuffer.duration;
            const y = rect.top + (percentage * rect.height) + window.scrollY;

            elements.phoneticInput.style.top = y + 'px';
            elements.phoneticInput.style.left = rect.right + window.scrollX + 5 + 'px';
        } else {
            elements.phoneticInput.style.top = '200px';
            elements.phoneticInput.style.left = '200px';
        }
        elements.phoneticInput.style.display = 'block';
        elements.phoneticText.focus();
    }

    function savePhoneticMarker() {
        if (!state.phoneticEditPosition) return;

        const text = elements.phoneticText.value.trim();
        const { time, editIndex } = state.phoneticEditPosition;

        if (!text) {
            if (editIndex >= 0) state.phonetics.splice(editIndex, 1);
        } else {
            if (editIndex >= 0) {
                state.phonetics[editIndex].text = text;
            } else {
                state.phonetics.push({ time, text });
                state.phonetics.sort((a, b) => a.time - b.time);
            }
        }
        elements.phoneticInput.style.display = 'none';
        renderPhoneticMarkers();
        if (app.state) app.state.modified = true;
    }

    /* ------------------------------------------------------------------ *
     *  Public API
     * ------------------------------------------------------------------ */

    const api = {
        init,
        drawWaveformInCells,     // kept for legacy calls elsewhere
        togglePlayAudio,
        stopAudio,
        state
    };

    app.Audio = api;
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);

//--- END OF FILE audio.js ---
