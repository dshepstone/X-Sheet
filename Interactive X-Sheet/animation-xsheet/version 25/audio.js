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
        // audioData: null, // <<< REMOVED - Unused
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
    let updatePositionRAFHandle = null;


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
        setupEventListeners(); // Sets up local listeners
        setupGlobalScrubListeners(); // <<< NEW - Sets up global bound functions for scrub
        listenForAppEvents();

        // Keep overlay aligned on scroll / resize
        window.addEventListener('scroll', requestUpdateWaveformOverlayPosition, { passive: true });
        window.addEventListener('resize', requestUpdateWaveformOverlayPosition, { passive: true });
    }

    function cacheElements() {
        elements = {
            audioButton: document.getElementById('audio-button'),
            audioUpload: document.getElementById('audio-upload'), // This is the hidden file input
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

        // <<< FIX: Check if critical elements were found
        if (!elements.audioButton) console.error("Audio Import Button ('audio-button') not found!");
        if (!elements.audioUpload) console.error("Audio File Input ('audio-upload') not found!");
    }

    function setupEventListeners() {
        // <<< FIX: Ensure audioUpload element exists before adding listener to audioButton
        if (elements.audioButton && elements.audioUpload) {
            elements.audioButton.addEventListener('click', () => {
                console.log("Audio import button clicked, attempting to trigger file input.");
                elements.audioUpload.click(); // This triggers the hidden file input
            });
        } else {
            console.error("Cannot setup audio import: button or file input element is missing.");
        }

        if (elements.audioUpload) { // <<< FIX: Check again for safety
            elements.audioUpload.addEventListener('change', (e) => {
                if (e.target.files.length) {
                    const file = e.target.files[0];
                    state.audioFileName = file.name;
                    loadAudioFile(file);
                }
            });
        }

        if (elements.playAudioButton) elements.playAudioButton.addEventListener('click', togglePlayAudio);
        if (elements.stopAudioButton) elements.stopAudioButton.addEventListener('click', stopAudio);
        if (elements.audioScrubber) elements.audioScrubber.addEventListener('input', scrubAudio);

        if (elements.addPhoneticButton) {
            elements.addPhoneticButton.addEventListener('click', () => {
                if (state.audioBuffer) showPhoneticInput(null);
                else if (app.updateStatusMessage) app.updateStatusMessage('Please load audio first');
            });
        }

        if (elements.savePhoneticButton) elements.savePhoneticButton.addEventListener('click', savePhoneticMarker);
        if (elements.cancelPhoneticButton) {
            elements.cancelPhoneticButton.addEventListener('click', () => {
                if (elements.phoneticInput) elements.phoneticInput.style.display = 'none';
            });
        }
    }

    function listenForAppEvents() {
        document.addEventListener('xsheet-updated', () => { if (state.audioBuffer) renderWaveform(); });
        document.addEventListener('xsheet-framecount-changed', () => { if (state.audioBuffer) renderWaveform(); });
        document.addEventListener('xsheet-template-changed', () => { if (state.audioBuffer) renderWaveform(); });

        document.addEventListener('xsheet-clear', () => {
            state.audioBuffer = null;
            state.audioSource = null;
            state.waveformData = [];
            state.phonetics = [];
            state.audioFileName = '';
            if (elements.audioInfo) elements.audioInfo.textContent = 'No audio loaded';

            stopAudio();
            removeScrubListeners(); //  <<< MODIFIED: Call the corrected version
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

                if (state.audioBuffer && state.phonetics.length) { // if buffer exists
                    renderWaveform();
                } else if (state.audioFileName && elements.audioInfo) { // If no buffer, but filename exists
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
                state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (state.audioContext.state === 'suspended') {
                    state.audioContext.resume().catch(err => console.warn("AudioContext initially suspended, resume failed:", err));
                }
            } catch (err) {
                if (app.updateStatusMessage) app.updateStatusMessage('Web Audio API is not supported');
                console.error(err);
                return;
            }
        } else if (state.audioContext.state === 'suspended') {
            // If context exists but suspended, try to resume.
            // This often needs to be triggered by a user gesture.
            state.audioContext.resume().then(() => {
                console.log("AudioContext resumed, proceeding with file read.");
                readFileAndDecode(file);
            }).catch(err => {
                console.error("Failed to resume existing AudioContext:", err);
                if (app.updateStatusMessage) app.updateStatusMessage('Failed to activate audio. Try interacting with page.');
            });
            return; // Don't proceed until resumed
        }

        readFileAndDecode(file);
    }

    function readFileAndDecode(file) {
        const reader = new FileReader();
        reader.onload = (eReader) => {
            decodeAudioDataFromBuffer(file.name, eReader.target.result);
        };
        reader.onerror = () => { if (app.updateStatusMessage) app.updateStatusMessage('Error reading audio file'); };
        reader.readAsArrayBuffer(file);
    }

    function decodeAudioDataFromBuffer(fileName, arrayBuffer) {
        if (!state.audioContext || state.audioContext.state !== 'running') {
            console.error("Cannot decode audio, AudioContext not running.");
            if (app.updateStatusMessage) app.updateStatusMessage('Audio system not ready.');
            // Try to re-initialize context if it's totally gone, this is unusual
            if (!state.audioContext) {
                try {
                    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    if (state.audioContext.state === 'suspended') state.audioContext.resume();
                } catch (e) { return; }
                if (state.audioContext.state !== 'running') return; // Still not running, give up
            }
        }

        if (app.updateStatusMessage) app.updateStatusMessage('Decoding audio…');
        state.audioContext.decodeAudioData(
            arrayBuffer,
            (buffer) => {
                state.audioBuffer = buffer;
                state.audioFileName = fileName;

                const duration = buffer.duration;
                const minutes = Math.floor(duration / 60);
                const seconds = Math.floor(duration % 60);
                const approxFrames = Math.ceil(duration * 24);

                if (elements.audioInfo) elements.audioInfo.textContent =
                    `${state.audioFileName} (${minutes}:${seconds.toString().padStart(2, '0')}, ~${approxFrames} frames @ 24fps)`;
                if (elements.playAudioButton) elements.playAudioButton.disabled = false;
                if (elements.stopAudioButton) elements.stopAudioButton.disabled = false;
                if (elements.audioScrubber) elements.audioScrubber.disabled = false;

                generateWaveformData(buffer);
                if (app.updateStatusMessage) app.updateStatusMessage(`Audio loaded: ${state.audioFileName}`);

                const currentSheetFrames = app.state ? app.state.frameCount : 96;
                const requiredFrames = Math.ceil(duration / state.frameDuration);

                if (requiredFrames > currentSheetFrames) {
                    if (confirm(
                        `Audio requires ~${requiredFrames} frames (@24fps), but sheet has ${currentSheetFrames}. Increase frame count?`
                    )) {
                        if (app.state) app.state.frameCount = requiredFrames;
                        if (document.getElementById('frame-count')) document.getElementById('frame-count').value = requiredFrames;
                        if (app.generateTable) app.generateTable(requiredFrames); // This should trigger 'xsheet-updated'
                        else renderWaveform(); // Fallback if generateTable doesn't trigger update
                    } else {
                        renderWaveform();
                    }
                } else {
                    renderWaveform();
                }
            },
            (errDecode) => {
                console.error('Audio decoding error:', errDecode);
                if (app.updateStatusMessage) app.updateStatusMessage(
                    'Error decoding audio: ' + (errDecode.message || 'Format may be unsupported')
                );
            }
        );
    }


    function generateWaveformData(buffer) {
        const rawData = buffer.getChannelData(0);
        const totalSamples = rawData.length;
        state.waveformData = [];
        const pointsPerSecond = 100;
        const totalPoints = Math.ceil(buffer.duration * pointsPerSecond);
        const step = Math.max(1, Math.floor(totalSamples / totalPoints));
        for (let i = 0; i < totalPoints; i++) {
            const index = Math.min(Math.floor(i * step), totalSamples - 1);
            state.waveformData.push(Math.abs(rawData[index]));
        }
        console.log(`Generated waveform data with ${state.waveformData.length} points.`);
    }

    // ... (drawWaveformOnCanvas - keep as is, it's mostly fine) ...
    function drawWaveformOnCanvas(canvas, waveData, audioDuration) {
        if (!canvas || !waveData || waveData.length === 0 || canvas.width <= 0 || canvas.height <= 0) return;
        const ctx = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height; ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Slightly transparent
        ctx.fillRect(0, 0, width, height);
        ctx.beginPath(); ctx.strokeStyle = '#dddddd'; ctx.lineWidth = 0.5; ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
        ctx.beginPath(); ctx.strokeStyle = '#333333'; ctx.lineWidth = 1;
        for (let i = 0; i < waveData.length; i++) { const y = (i / waveData.length) * height; const amplitude = waveData[i] * (width * 0.45); const x = (width / 2) + amplitude; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        for (let i = waveData.length - 1; i >= 0; i--) { const y = (i / waveData.length) * height; const amplitude = waveData[i] * (width * 0.45); const x = (width / 2) - amplitude; ctx.lineTo(x, y); } ctx.stroke();
        const xsheetTableBody = document.getElementById('xsheet-body'); if (!xsheetTableBody) return; const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length; const framesPerSecond = 24; const totalAudioFrames = Math.ceil(audioDuration * framesPerSecond);
        for (let i = 1; i <= totalAudioFrames && i <= totalRows; i++) { const yPos = (i / totalRows) * height; if (i % 8 === 0) { ctx.beginPath(); ctx.strokeStyle = (i % 24 === 0) ? '#888888' : '#bbbbbb'; ctx.lineWidth = (i % 24 === 0) ? 1.5 : 0.75; ctx.moveTo(0, yPos); ctx.lineTo(width, yPos); ctx.stroke(); } }
    }

    // <<< MODIFIED: Centralize scrub listener setup
    function setupGlobalScrubListeners() {
        boundHandleScrubMove = (e) => {
            if (!isScrubbing || !state.audioBuffer || !activeWaveformContainer) return;
            const overlay = activeWaveformContainer.querySelector('.waveform-overlay');
            if (!overlay) return;
            if (e.pointerType === 'mouse' && e.buttons !== 1) {
                boundHandleScrubEnd(e); return;
            }
            updateScrubPosition(e, overlay);
        };

        boundHandleScrubEnd = (e) => {
            if (!isScrubbing) return;
            if (e.type === 'mouseup' && e.button !== 0) return;
            isScrubbing = false;
            if (e.pointerId && activeWaveformContainer) {
                const overlay = activeWaveformContainer.querySelector('.waveform-overlay');
                if (overlay && overlay.hasPointerCapture(e.pointerId)) {
                    try { overlay.releasePointerCapture(e.pointerId); } catch (err) { }
                }
            }
            if (scrubSource) { try { scrubSource.stop(); } catch (err) { } scrubSource = null; }
            console.log("Scrub: ENDED via document listener.");
        };

        document.addEventListener('mousemove', boundHandleScrubMove);
        document.addEventListener('pointermove', boundHandleScrubMove);
        document.addEventListener('mouseup', boundHandleScrubEnd);
        document.addEventListener('pointerup', boundHandleScrubEnd);
        console.log("Scrub: Global document listeners attached.");
    }

    // <<< MODIFIED: removeScrubListeners now correctly uses the stored bound functions
    function removeScrubListeners() {
        if (boundHandleScrubMove) {
            document.removeEventListener('mousemove', boundHandleScrubMove);
            document.removeEventListener('pointermove', boundHandleScrubMove);
            // boundHandleScrubMove = null; // Don't nullify, keep for re-attachment if needed
        }
        if (boundHandleScrubEnd) {
            document.removeEventListener('mouseup', boundHandleScrubEnd);
            document.removeEventListener('pointerup', boundHandleScrubEnd);
            // boundHandleScrubEnd = null;
        }
        console.log("Scrub: Document listeners explicitly removed (or were already null).");
    }

    let isScrubbing = false; // <<< MOVED: Module-level flag for scrubbing state

    function renderWaveform() {
        if (!state.audioBuffer || state.waveformData.length === 0) return;
        console.log('Rendering waveform overlay...');

        // Remove any existing waveform container
        if (activeWaveformContainer) {
            activeWaveformContainer.remove();
            activeWaveformContainer = null;
        }

        // Important: Target the specific waveform column cells
        const waveformCells = document.querySelectorAll('.waveform-col[data-frame]');
        if (waveformCells.length === 0) {
            console.error("No waveform cells found for audio visualization");
            return;
        }

        // Get the first cell for reference
        const firstCell = waveformCells[0];
        const xsheetTableBody = document.getElementById('xsheet-body');
        const printableArea = document.getElementById('printable-area');

        if (!firstCell || !xsheetTableBody || !printableArea) {
            console.error("Required elements missing for waveform rendering");
            return;
        }

        // Calculate total height based on all frames
        const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length;
        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;
        const cellWidth = firstCell.offsetWidth;

        // Verify dimensions are valid
        if (totalHeight <= 0 || cellWidth <= 0) {
            console.warn("Invalid waveform cell dimensions, cannot render waveform");
            return;
        }

        // Create the waveform container
        activeWaveformContainer = document.createElement('div');
        activeWaveformContainer.className = 'waveform-container';
        activeWaveformContainer.id = 'audio-waveform-container';

        // Get precise positioning relative to the printable area
        const firstCellRect = firstCell.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        // Calculate relative position to printable area
        const relativeTop = firstCellRect.top - printableRect.top;
        const relativeLeft = firstCellRect.left - printableRect.left;

        // Apply exact positioning to align with waveform column
        activeWaveformContainer.style.position = 'absolute';
        activeWaveformContainer.style.top = relativeTop + 'px';
        activeWaveformContainer.style.left = relativeLeft + 'px';
        activeWaveformContainer.style.width = cellWidth + 'px';
        activeWaveformContainer.style.height = totalHeight + 'px';

        // Set other styling properties
        activeWaveformContainer.style.zIndex = '20'; // Above table but below drawing layer
        activeWaveformContainer.style.pointerEvents = 'none';
        activeWaveformContainer.style.backgroundColor = 'transparent';
        activeWaveformContainer.style.overflow = 'visible';

        // Create canvas for waveform visualization
        const canvas = document.createElement('canvas');
        canvas.className = 'waveform-canvas';
        canvas.width = cellWidth;
        canvas.height = totalHeight;
        canvas.style.pointerEvents = 'none';
        activeWaveformContainer.appendChild(canvas);

        // Create overlay for interaction
        const overlay = document.createElement('div');
        overlay.className = 'waveform-overlay';
        overlay.style.height = totalHeight + 'px';
        overlay.style.pointerEvents = 'auto';
        activeWaveformContainer.appendChild(overlay);

        // Add event listeners for audio scrubbing
        setupWaveformOverlayEvents(overlay);

        // Add to printable area
        printableArea.appendChild(activeWaveformContainer);

        // Draw waveform and markers
        drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
        renderPhoneticMarkers();
        updateFrameMarker();

        console.log("Waveform rendering complete");
    }

    // Helper function to setup events on the waveform overlay
    function setupWaveformOverlayEvents(overlay) {
        // Mouse down event for scrubbing
        overlay.addEventListener('mousedown', (e) => {
            if (!state.audioBuffer || e.button !== 0 || !isScrubbingAllowed(e.target)) return;
            isScrubbing = true;
            console.log("Scrub: mousedown (overlay) -> isScrubbing = true");
            if (state.isPlaying) pauseAudio();
            if (!state.audioContext || state.audioContext.state !== 'running') {
                state.audioContext?.resume();
            }
            updateScrubPosition(e, overlay);
            e.preventDefault();
            e.stopPropagation();
        });

        // Pointer down event for touch/pen devices
        overlay.addEventListener('pointerdown', (e) => {
            if (!state.audioBuffer || (e.pointerType !== 'pen' && e.button !== 0) || !isScrubbingAllowed(e.target)) return;
            isScrubbing = true;
            console.log("Scrub: pointerdown (overlay) -> isScrubbing = true", e.pointerType);
            if (state.isPlaying) pauseAudio();
            if (!state.audioContext || state.audioContext.state !== 'running') {
                state.audioContext?.resume();
            }
            try { overlay.setPointerCapture(e.pointerId); } catch (err) { }
            updateScrubPosition(e, overlay);
            e.preventDefault();
            e.stopPropagation();
        });

        // Click event for positioning without dragging
        overlay.addEventListener('click', (e) => {
            if (isScrubbing || !state.audioBuffer || !isScrubbingAllowed(e.target)) return;
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const p = Math.max(0, Math.min(1, y / rect.height));
            const timePoint = p * state.audioBuffer.duration;
            elements.audioScrubber.value = (p * 100);
            state.startOffset = timePoint;
            if (state.isPlaying) {
                stopAudio();
                playAudio();
            } else {
                updateFrameMarker();
            }
        });

        // Right-click for phonetic input
        overlay.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!state.audioBuffer) return;
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const p = Math.max(0, Math.min(1, y / rect.height));
            showPhoneticInput(p * state.audioBuffer.duration);
            return false;
        });
    }
    
    function isScrubbingAllowed(targetElement) { return targetElement?.classList.contains('waveform-overlay'); }

    // ... (updateScrubPosition, playScrubAudio - keep as corrected previously with throttle) ...
    function updateScrubPosition(e, overlayElement) { const rect = overlayElement.getBoundingClientRect(); const y = e.clientY - rect.top; const percentage = Math.max(0, Math.min(1, y / rect.height)); const timePoint = percentage * state.audioBuffer.duration; if (Math.abs(state.startOffset - timePoint) > 0.005) { state.startOffset = timePoint; elements.audioScrubber.value = percentage * 100; const now = Date.now(); if (now - lastScrubPlayTime > scrubThrottleDelay) { playScrubAudio(timePoint); lastScrubPlayTime = now; } updateFrameMarker(); } }
    let scrubSource = null; function playScrubAudio(timePoint) { if (scrubSource) { try { scrubSource.onended = null; scrubSource.stop(); } catch (e) { } scrubSource = null; } if (!state.audioContext || !state.audioBuffer) return; if (state.audioContext.state === 'suspended') { state.audioContext.resume().catch(err => console.error("Error resuming AC:", err)); } if (state.audioContext.state !== 'running') { console.warn("AC not running"); return; } scrubSource = state.audioContext.createBufferSource(); scrubSource.buffer = state.audioBuffer; const gainNode = state.audioContext.createGain(); gainNode.gain.setValueAtTime(0.8, state.audioContext.currentTime); scrubSource.connect(gainNode); gainNode.connect(state.audioContext.destination); const snippetDuration = 1 / 15; try { scrubSource.start(0, Math.max(0, timePoint), snippetDuration); scrubSource.onended = () => { if (scrubSource) { scrubSource.disconnect(); gainNode.disconnect(); } scrubSource = null; }; } catch (e) { console.warn("Error starting scrub audio:", e.message); if (scrubSource) scrubSource.disconnect(); if (gainNode) gainNode.disconnect(); scrubSource = null; } }

    function requestUpdateWaveformOverlayPosition() {
        if (updatePositionRAFHandle) cancelAnimationFrame(updatePositionRAFHandle);
        updatePositionRAFHandle = requestAnimationFrame(updateWaveformOverlayPosition);
    }

    function updateWaveformOverlayPosition() {
        if (!activeWaveformContainer || !state.audioBuffer) {
            updatePositionRAFHandle = null;
            return;
        }

        // Important: Target the specific waveform column cells
        const waveformCells = document.querySelectorAll('.waveform-col[data-frame]');
        if (waveformCells.length === 0) {
            console.warn("No waveform cells found, hiding waveform container");
            activeWaveformContainer.style.display = 'none';
            updatePositionRAFHandle = null;
            return;
        }

        // Get the first cell for reference
        const firstCell = waveformCells[0];
        if (!firstCell || firstCell.offsetWidth === 0 || firstCell.offsetHeight === 0) {
            console.warn("Waveform cell has zero dimensions, hiding waveform container");
            activeWaveformContainer.style.display = 'none';
            updatePositionRAFHandle = null;
            return;
        }

        // Get the printable area
        const printableArea = document.getElementById('printable-area');
        if (!printableArea) {
            console.error("Printable area not found");
            updatePositionRAFHandle = null;
            return;
        }

        // Calculate position relative to printable area
        const firstCellRect = firstCell.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();
        const relativeTop = firstCellRect.top - printableRect.top;
        const relativeLeft = firstCellRect.left - printableRect.left;

        // Get total height of all cells
        const totalRows = document.querySelectorAll('tr.frame-[data-frame]').length ||
            document.querySelectorAll('tr[data-frame]').length ||
            document.querySelectorAll('#xsheet-body tr').length;
        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;

        // Update container position and size
        activeWaveformContainer.style.display = 'block';
        activeWaveformContainer.style.top = relativeTop + 'px';
        activeWaveformContainer.style.left = relativeLeft + 'px';

        // Check if dimensions have changed
        const cellWidth = firstCell.offsetWidth;
        if (activeWaveformContainer.offsetWidth !== cellWidth ||
            activeWaveformContainer.offsetHeight !== totalHeight) {
            activeWaveformContainer.style.width = cellWidth + 'px';
            activeWaveformContainer.style.height = totalHeight + 'px';

            // Update canvas dimensions if needed
            const canvas = activeWaveformContainer.querySelector('.waveform-canvas');
            if (canvas && (canvas.width !== cellWidth || canvas.height !== totalHeight)) {
                canvas.width = cellWidth;
                canvas.height = totalHeight;
                drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
            }

            // Update overlay height
            const overlay = activeWaveformContainer.querySelector('.waveform-overlay');
            if (overlay) {
                overlay.style.height = totalHeight + 'px';
            }
        }

        // Update markers
        renderPhoneticMarkers();
        updateFrameMarker();

        updatePositionRAFHandle = null;
    }

    // Function to ensure waveform stays correctly positioned when table changes
    function ensureWaveformPositioningOnTableChanges() {
        // Listen for table updates
        document.addEventListener('xsheet-updated', () => {
            if (state.audioBuffer) {
                setTimeout(() => {
                    renderWaveform();
                }, 100);
            }
        });

        document.addEventListener('xsheet-template-changed', () => {
            if (state.audioBuffer) {
                setTimeout(() => {
                    renderWaveform();
                }, 100);
            }
        });

        // Monitor window resize
        window.addEventListener('resize', () => {
            if (activeWaveformContainer) {
                requestAnimationFrame(updateWaveformOverlayPosition);
            }
        }, { passive: true });

        // Monitor scroll events
        window.addEventListener('scroll', () => {
            if (activeWaveformContainer) {
                requestAnimationFrame(updateWaveformOverlayPosition);
            }
        }, { passive: true });
    }

    // Initialize positioning hooks when document loads
    document.addEventListener('DOMContentLoaded', ensureWaveformPositioningOnTableChanges);

    // ... (renderPhoneticMarkers, updateFrameMarker, togglePlayAudio, playAudio, pauseAudio, stopAudio, scrubAudio, showPhoneticInput, savePhoneticMarker, drawWaveformInCells - keep as previously corrected) ...
    // All these functions are largely the same as the previous "good" version.
    // Make sure to re-paste them from the previous *complete* audio.js if you made snippet-only changes.
    function renderPhoneticMarkers() { if (!activeWaveformContainer || !state.phonetics || !state.audioBuffer) return; const existingLabels = activeWaveformContainer.querySelectorAll('.phonetic-label'); existingLabels.forEach(label => label.remove()); const containerHeight = activeWaveformContainer.offsetHeight; if (containerHeight <= 0) return; state.phonetics.forEach((phonetic, index) => { const percentage = phonetic.time / state.audioBuffer.duration; const yPosition = percentage * containerHeight; const label = document.createElement('div'); label.className = 'phonetic-label'; label.textContent = phonetic.text; const labelHeight = 12; label.style.cssText = `position: absolute; left: 2px; top: ${Math.max(0, Math.min(yPosition, containerHeight - labelHeight))}px; z-index: 25;`; label.addEventListener('dblclick', () => showPhoneticInput(phonetic.time, phonetic.text, index)); activeWaveformContainer.appendChild(label); }); }
    function updateFrameMarker() { if (!activeWaveformContainer || !state.audioBuffer || !state.audioContext) return; const existingMarkers = activeWaveformContainer.querySelectorAll('.waveform-marker'); existingMarkers.forEach(marker => marker.remove()); const time = state.isPlaying ? (state.audioContext.currentTime - state.startTime + state.startOffset) : state.startOffset; const frame = Math.floor(time / state.frameDuration) + 1; state.currentFrame = frame; const containerHeight = activeWaveformContainer.offsetHeight; if (containerHeight <= 0) return; const percentage = Math.max(0, Math.min(1, time / state.audioBuffer.duration)); const yPosition = percentage * containerHeight; const marker = document.createElement('div'); marker.className = 'waveform-marker'; marker.style.cssText = `position: absolute; top: ${Math.min(yPosition, containerHeight - 2)}px; left: 0; width: 100%; height: 2px; background-color: rgba(255, 0, 0, 0.7); z-index: 30; line-height: 0; text-align: right; color: red; font-weight: bold; font-size: 8pt; pointer-events: none;`; marker.textContent = `Frame ${frame}`; activeWaveformContainer.appendChild(marker); if (state.isPlaying && activeWaveformContainer && document.getElementById('xsheet-table')) { const tableRect = document.getElementById('xsheet-table').getBoundingClientRect(); const markerAbsoluteY = activeWaveformContainer.getBoundingClientRect().top + yPosition; if (markerAbsoluteY < tableRect.top || markerAbsoluteY > tableRect.bottom) { const scrollTargetY = window.scrollY + markerAbsoluteY - (window.innerHeight / 2); window.scrollTo({ top: scrollTargetY, behavior: 'smooth' }); } } elements.audioScrubber.value = percentage * 100; if (state.isPlaying) requestAnimationFrame(updateFrameMarker); }
    function togglePlayAudio() { if (!state.audioContext && state.audioBuffer) { try { state.audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { if (app.updateStatusMessage) app.updateStatusMessage("Audio Error"); return; } } if (state.audioContext && state.audioContext.state === 'suspended') { state.audioContext.resume().then(() => { if (state.isPlaying) pauseAudio(); else playAudio(); }).catch(err => console.error("AC Resume Error:", err)); } else { if (state.isPlaying) pauseAudio(); else playAudio(); } }
    function playAudio() { if (!state.audioBuffer || !state.audioContext || state.audioContext.state !== 'running') { console.warn("Cannot play audio - buffer or running context missing."); return; } if (state.audioSource) { try { state.audioSource.stop(); } catch (e) { } } state.audioSource = state.audioContext.createBufferSource(); state.audioSource.buffer = state.audioBuffer; state.audioSource.connect(state.audioContext.destination); state.startTime = state.audioContext.currentTime; let offset = state.startOffset % state.audioBuffer.duration; if (offset < 0 || isNaN(offset)) offset = 0; try { state.audioSource.start(0, offset); state.isPlaying = true; updateFrameMarker(); elements.playAudioButton.textContent = 'Pause'; state.audioSource.onended = () => { if (state.isPlaying) { stopAudio(); } }; } catch (e) { console.error("Error starting playback:", e); state.isPlaying = false; elements.playAudioButton.textContent = 'Play'; if (app.updateStatusMessage) app.updateStatusMessage("Error playing audio"); } }
    function pauseAudio() { if (!state.isPlaying || !state.audioSource || !state.audioContext) return; try { state.audioSource.stop(); } catch (e) { } state.startOffset += (state.audioContext.currentTime - state.startTime); state.audioSource = null; state.isPlaying = false; elements.playAudioButton.textContent = 'Play'; if (updatePositionRAFHandle) cancelAnimationFrame(updatePositionRAFHandle); }
    function stopAudio() { if (state.audioSource) { try { state.audioSource.onended = null; state.audioSource.stop(); } catch (e) { } state.audioSource = null; } state.isPlaying = false; state.startOffset = 0; elements.playAudioButton.textContent = 'Play'; elements.audioScrubber.value = 0; if (updatePositionRAFHandle) { cancelAnimationFrame(updatePositionRAFHandle); updatePositionRAFHandle = null; } updateFrameMarker(); }
    function scrubAudio() { if (!state.audioBuffer) return; const p = elements.audioScrubber.value / 100; const newTime = Math.max(0, Math.min(p * state.audioBuffer.duration, state.audioBuffer.duration)); state.startOffset = newTime; if (state.isPlaying) { pauseAudio(); state.startOffset = newTime; playAudio(); } else { updateFrameMarker(); } }
    function showPhoneticInput(time, initialText = '', editIndex = -1) { if (time === null && state.audioContext) time = state.isPlaying ? (state.audioContext.currentTime - state.startTime + state.startOffset) : state.startOffset; if (state.audioBuffer) time = Math.max(0, Math.min(time, state.audioBuffer.duration)); state.phoneticEditPosition = { time: time, editIndex: editIndex }; elements.phoneticText.value = initialText; if (activeWaveformContainer && state.audioBuffer) { const parentRect = activeWaveformContainer.parentElement.getBoundingClientRect(); const containerRect = activeWaveformContainer.getBoundingClientRect(); const p = time / state.audioBuffer.duration; const yPosInContainer = p * containerRect.height; elements.phoneticInput.style.top = `${parentRect.top + yPosInContainer + window.scrollY}px`; elements.phoneticInput.style.left = `${parentRect.left + containerRect.width + window.scrollX + 5}px`; } else { elements.phoneticInput.style.top = '200px'; elements.phoneticInput.style.left = '200px'; } elements.phoneticInput.style.display = 'block'; elements.phoneticText.focus(); }
    function savePhoneticMarker() { if (!state.phoneticEditPosition) return; const text = elements.phoneticText.value.trim(); const index = state.phoneticEditPosition.editIndex; if (text === '') { if (index >= 0 && index < state.phonetics.length) state.phonetics.splice(index, 1); } else { if (index >= 0 && index < state.phonetics.length) state.phonetics[index].text = text; else { state.phonetics.push({ time: state.phoneticEditPosition.time, text: text }); state.phonetics.sort((a, b) => a.time - b.time); } } elements.phoneticInput.style.display = 'none'; renderPhoneticMarkers(); if (app.state) app.state.modified = true; }
    function drawWaveformInCells() { const waveformCells = document.querySelectorAll('#xsheet-body .waveform-col'); if (waveformCells.length === 0 || !state.audioBuffer || state.waveformData.length === 0) return; const totalAudioDuration = state.audioBuffer.duration; const pointsPerFrame = state.waveformData.length / (totalAudioDuration * 24); waveformCells.forEach((cell) => { cell.setAttribute('data-original-content', cell.innerHTML); const frameNum = parseInt(cell.parentElement.dataset.frame); if (isNaN(frameNum)) return; const canvas = document.createElement('canvas'); canvas.width = cell.offsetWidth; canvas.height = cell.offsetHeight; if (canvas.width <= 0 || canvas.height <= 0) return; canvas.style.display = 'block'; const ctx = canvas.getContext('2d', { alpha: true }); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.beginPath(); ctx.strokeStyle = '#cccccc'; ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height); ctx.stroke(); const startPoint = Math.floor((frameNum - 1) * pointsPerFrame); const endPoint = Math.floor(frameNum * pointsPerFrame); if (startPoint < state.waveformData.length && endPoint > startPoint) { ctx.beginPath(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 0.75; for (let i = startPoint; i <= endPoint && i < state.waveformData.length; i++) { const relativePos = Math.max(0, Math.min(1, (i - startPoint) / (endPoint - startPoint))); const y = relativePos * canvas.height; const amplitude = state.waveformData[i] * (canvas.width * 0.45); const x = (canvas.width / 2) + amplitude; if (i === startPoint) ctx.moveTo(x, y); else ctx.lineTo(x, y); } for (let i = endPoint; i >= startPoint && i < state.waveformData.length; i--) { const relativePos = Math.max(0, Math.min(1, (i - startPoint) / (endPoint - startPoint))); const y = relativePos * canvas.height; const amplitude = state.waveformData[i] * (canvas.width * 0.45); const x = (canvas.width / 2) - amplitude; ctx.lineTo(x, y); } ctx.stroke(); if (state.phonetics?.length > 0) { state.phonetics.forEach(phonetic => { const frameOfMarker = Math.floor(phonetic.time / state.frameDuration) + 1; if (frameOfMarker === frameNum) { const posInFrameRatio = (phonetic.time - ((frameNum - 1) * state.frameDuration)) / state.frameDuration; const yPos = Math.min(canvas.height - 1, Math.max(1, posInFrameRatio * canvas.height)); ctx.beginPath(); ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 1; ctx.moveTo(0, yPos); ctx.lineTo(canvas.width, yPos); ctx.stroke(); if (canvas.width > 30) { ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; const textWidth = ctx.measureText(phonetic.text).width; if (textWidth < canvas.width - 4) { ctx.fillRect(2, Math.max(0, yPos - 8), textWidth + 4, 14); ctx.fillStyle = '#ff0000'; ctx.font = '8px Arial'; ctx.fillText(phonetic.text, 4, Math.min(canvas.height - 2, yPos + 4)); } } } }); } } cell.innerHTML = ''; cell.appendChild(canvas); }); }

    const api = { init, drawWaveformInCells, togglePlayAudio, stopAudio, state };
    app.Audio = api;
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
