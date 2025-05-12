//--- START OF FILE audio.js ---

/**
 * audio.js - Audio processing and waveform visualization
 * Handles audio loading, playback, and waveform visualization for the X-Sheet
 */

// Create namespace for audio module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Audio = window.XSheetApp.Audio || {};

(function(app) {
    'use strict';
    
    // Audio module state
    const state = {
        audioContext: null,
        audioBuffer: null,
        audioSource: null,
        audioData: null, // This seems unused, can be removed if not needed elsewhere
        isPlaying: false,
        startTime: 0,
        startOffset: 0,
        audioFileName: '',
        waveformData: [],
        // waveformCanvases: [], // This seems unused, replaced by the single live waveform canvas
        phonetics: [],
        frameDuration: 1 / 24, // 24fps
        currentFrame: 0,
        phoneticEditPosition: null
    };
    
    // DOM Elements
    let elements = {};
    let activeWaveformContainer = null; // To keep track of the current live waveform container

    // Initialize audio module
    function init() {
        cacheElements();
        setupEventListeners();
        listenForAppEvents();

        // Add listeners for scroll and resize to keep waveform overlay aligned
        window.addEventListener('scroll', updateWaveformOverlayPosition, { passive: true });
        window.addEventListener('resize', updateWaveformOverlayPosition, { passive: true });
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
        elements.audioButton.addEventListener('click', function() {
            elements.audioUpload.click();
        });
        
        elements.audioUpload.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                state.audioFileName = file.name;
                loadAudioFile(file);
            }
        });
        
        elements.playAudioButton.addEventListener('click', togglePlayAudio);
        elements.stopAudioButton.addEventListener('click', stopAudio);
        elements.audioScrubber.addEventListener('input', scrubAudio);
        
        elements.addPhoneticButton.addEventListener('click', function() {
            if (state.audioBuffer) {
                showPhoneticInput(null);
            } else {
                app.updateStatusMessage('Please load audio first');
            }
        });
        
        elements.savePhoneticButton.addEventListener('click', savePhoneticMarker);
        elements.cancelPhoneticButton.addEventListener('click', function() {
            elements.phoneticInput.style.display = 'none';
        });
    }
    
    function listenForAppEvents() {
        document.addEventListener('xsheet-updated', function() {
            if (state.audioBuffer) {
                renderWaveform(); // This will also update position if table changed
            }
        });
        
        document.addEventListener('xsheet-framecount-changed', function() {
            if (state.audioBuffer) {
                renderWaveform();
            }
        });
        
        document.addEventListener('xsheet-template-changed', function() {
            if (state.audioBuffer) {
                renderWaveform();
            }
        });
        
        document.addEventListener('xsheet-clear', function() {
            state.audioBuffer = null;
            state.audioSource = null;
            state.waveformData = [];
            state.phonetics = [];
            state.audioFileName = '';
            elements.audioInfo.textContent = 'No audio loaded';
            
            stopAudio();
            
            // Clear existing waveform container if it exists
            if (activeWaveformContainer) {
                activeWaveformContainer.remove();
                activeWaveformContainer = null;
            }
            // No need to clear individual waveform canvases as we have one main one.
        });
        
        document.addEventListener('xsheet-collect-data', function(e) {
            if (e.detail && e.detail.data) {
                e.detail.data.audio = {
                    fileName: state.audioFileName,
                    phonetics: state.phonetics
                };
            }
        });
        
        document.addEventListener('xsheet-restore-data', function(e) {
            if (e.detail && e.detail.data && e.detail.data.audio) {
                state.audioFileName = e.detail.data.audio.fileName || '';
                state.phonetics = e.detail.data.audio.phonetics || [];
                
                // If audio was loaded via file *before* project load, it might already be there.
                // This implies audio files themselves are not saved in the project JSON.
                if (state.audioBuffer && state.phonetics.length > 0) {
                    renderWaveform();
                } else if (state.audioFileName && state.phonetics.length > 0) {
                    // Potentially prompt to re-load the audio file by name if needed
                    elements.audioInfo.textContent = `Audio: ${state.audioFileName} (markers loaded, file not present)`;
                }
            }
        });
    }

    function loadAudioFile(file) {
        if (!state.audioContext) {
            try {
                window.AudioContext = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioContext();
            } catch (e) {
                app.updateStatusMessage('Web Audio API is not supported in this browser');
                return;
            }
        }
        
        const reader = new FileReader();
        reader.onload = function(e_reader) {
            app.updateStatusMessage('Decoding audio...');
            state.audioContext.decodeAudioData(e_reader.target.result, 
                function(buffer) {
                    state.audioBuffer = buffer;
                    const duration = buffer.duration;
                    const minutes = Math.floor(duration / 60);
                    const seconds = Math.floor(duration % 60);
                    const frameCount = Math.ceil(duration * 24);
                    
                    elements.audioInfo.textContent = `${state.audioFileName} (${minutes}:${seconds.toString().padStart(2, '0')}, ${frameCount} frames @ 24fps)`;
                    elements.playAudioButton.disabled = false;
                    elements.stopAudioButton.disabled = false;
                    elements.audioScrubber.disabled = false;
                    
                    generateWaveformData(buffer);
                    app.updateStatusMessage('Audio loaded: ' + state.audioFileName);
                    
                    if (app.state && frameCount > app.state.frameCount) {
                        if (confirm(`This audio is ${frameCount} frames long at 24fps, but your X-sheet only has ${app.state.frameCount} frames. Do you want to increase the frame count?`)) {
                            app.state.frameCount = frameCount;
                            document.getElementById('frame-count').value = frameCount;
                            if (app.generateTable) app.generateTable(frameCount); // Will trigger xsheet-updated
                            else renderWaveform(); // Fallback if generateTable isn't available or doesn't trigger update
                        } else {
                            renderWaveform();
                        }
                    } else {
                        renderWaveform();
                    }
                }, 
                function(e_decode) {
                    console.error('Audio decoding error:', e_decode);
                    app.updateStatusMessage('Error decoding audio: ' + (e_decode.message || 'Format may be unsupported'));
                }
            );
        };
        reader.onerror = function() {
            app.updateStatusMessage('Error reading audio file');
        };
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
            const index = Math.floor(i * step);
            if (index < totalSamples) {
                state.waveformData.push(Math.abs(rawData[index]));
            }
        }
    }

    function drawWaveformOnCanvas(canvas, waveData, audioDuration) {
        if (!canvas || !waveData || waveData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);
        // Set a fill style. If you want table lines to show through the waveform graph itself, use 'transparent'
        // or a semi-transparent color. For a solid waveform background, use a solid color like '#ffffff'.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; // Semi-transparent white background for the waveform plot area
        ctx.fillRect(0, 0, width, height);

        // Draw center line
        ctx.beginPath();
        ctx.strokeStyle = '#cccccc';
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        // Draw the waveform
        ctx.beginPath();
        ctx.strokeStyle = '#000000';
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

        const xsheetTableBody = document.getElementById('xsheet-body');
        if (!xsheetTableBody) return;
        const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length;
        
        const framesPerSecond = 24; 
        const totalAudioFrames = Math.ceil(audioDuration * framesPerSecond);

        for (let i = 1; i <= totalAudioFrames && i <= totalRows; i++) {
            // Calculate y position based on frame's proportional height in the visible table
            // This assumes each row contributes equally to the totalHeight represented by the canvas.
            const yPos = (i / totalRows) * height; 
            
            if (i % 8 === 0) { // Major tick for 8 frames
                ctx.beginPath();
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = (i % 24 === 0) ? 2 : 1; // Thicker for 24 frames
                ctx.moveTo(0, yPos);
                ctx.lineTo(width, yPos);
                ctx.stroke();
            } else { // Minor tick for each frame (optional, can be too busy)
                // ctx.beginPath();
                // ctx.strokeStyle = '#e0e0e0';
                // ctx.lineWidth = 0.5;
                // ctx.moveTo(width * 0.4, yPos);
                // ctx.lineTo(width * 0.6, yPos);
                // ctx.stroke();
            }
        }
    }
    
    function renderWaveform() {
        if (!state.audioBuffer || state.waveformData.length === 0) return;
        
        if (activeWaveformContainer) {
            activeWaveformContainer.remove(); // Remove old one if exists
        }
        
        const table = document.getElementById('xsheet-table');
        const firstCell = table.querySelector('.waveform-col[data-frame="1"]');
        if (!firstCell) return;
        
        const xsheetTableBody = document.getElementById('xsheet-body');
        if (!xsheetTableBody) return;
        const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length;

        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;
        
        const waveformContainer = document.createElement('div');
        waveformContainer.className = 'waveform-container';
        
        const canvas = document.createElement('canvas');
        canvas.className = 'waveform-canvas';
        canvas.width = firstCell.offsetWidth;
        canvas.height = totalHeight;
        waveformContainer.appendChild(canvas);
        
        const overlay = document.createElement('div');
        overlay.className = 'waveform-overlay';
        overlay.style.height = totalHeight + 'px';
        
        // Event listeners for overlay (click, mousedown, mousemove, mouseup, contextmenu)
        overlay.addEventListener('click', function(e) {
            if (!state.audioBuffer) return;
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const percentage = y / rect.height;
            const timePoint = percentage * state.audioBuffer.duration;
            elements.audioScrubber.value = (timePoint / state.audioBuffer.duration) * 100;
            state.startOffset = timePoint;
            if (state.isPlaying) {
                stopAudio(); // Stop and restart from new point
                playAudio();
            }
            updateFrameMarker();
        });

        let isScrubbing = false;
        overlay.addEventListener('mousedown', function(e) {
            if (!state.audioBuffer || e.button !== 0) return;
            isScrubbing = true;
            if (state.isPlaying) pauseAudio();
            if (!state.audioContext) { /* ... error handling ... */ return; }
            updateScrubPosition(e, overlay);
            e.preventDefault();
        });
        overlay.addEventListener('pointerdown', function(e) {
            if (!state.audioBuffer || (e.pointerType !== 'pen' && e.button !==0)) return;
            isScrubbing = true;
            if (state.isPlaying) pauseAudio();
            updateScrubPosition(e, overlay);
            e.preventDefault();
        });
        overlay.addEventListener('mousemove', function(e) {
            if (!isScrubbing || !state.audioBuffer) return;
            updateScrubPosition(e, overlay);
        });
        overlay.addEventListener('pointermove', function(e) {
            if (isScrubbing && e.pointerType === 'pen' && e.pressure > 0) {
                updateScrubPosition(e, overlay);
            }
        });
        overlay.addEventListener('mouseup', function() { isScrubbing = false; });
        overlay.addEventListener('pointerup', function(e) { if (e.pointerType === 'pen') isScrubbing = false;});
        overlay.addEventListener('mouseleave', function() { isScrubbing = false; });
        
        overlay.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            if (!state.audioBuffer) return;
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const percentage = y / rect.height;
            const timePoint = percentage * state.audioBuffer.duration;
            showPhoneticInput(timePoint);
            return false;
        });
        waveformContainer.appendChild(overlay);
        
        document.body.appendChild(waveformContainer);
        activeWaveformContainer = waveformContainer; // Store reference

        // Initial positioning
        updateWaveformOverlayPosition(); // This now handles positioning and drawing

        // Draw waveform content on canvas
        drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
        
        renderPhoneticMarkers();
        updateFrameMarker();
    }

    function updateScrubPosition(e, overlayElement) { // Pass overlay to getBoundingClientRect
        const rect = overlayElement.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const percentage = Math.max(0, Math.min(1, y / rect.height));
        const timePoint = percentage * state.audioBuffer.duration;
        state.startOffset = timePoint;
        elements.audioScrubber.value = percentage * 100;
        playScrubAudio(timePoint);
        updateFrameMarker();
    }
    
    let scrubSource = null;
    function playScrubAudio(timePoint) {
        if (scrubSource) {
            try { scrubSource.stop(); } catch (e) { /* ignore */ }
        }
        if (!state.audioContext || !state.audioBuffer) return;
        scrubSource = state.audioContext.createBufferSource();
        scrubSource.buffer = state.audioBuffer;
        scrubSource.connect(state.audioContext.destination);
        const snippetDuration = 1 / 12;
        try {
             scrubSource.start(0, timePoint, snippetDuration);
        } catch (e) {
            console.warn("Error starting scrub audio, possibly due to quick succession:", e.message);
        }
    }
    
    function updateWaveformOverlayPosition() {
        if (!activeWaveformContainer || !state.audioBuffer) return;

        const table = document.getElementById('xsheet-table');
        const firstCell = table ? table.querySelector('.waveform-col[data-frame="1"]') : null;
        
        if (!table || !firstCell) {
            activeWaveformContainer.style.display = 'none';
            return;
        }
        activeWaveformContainer.style.display = 'block';

        const cellRect = firstCell.getBoundingClientRect();
        const xsheetTableBody = document.getElementById('xsheet-body');
        if (!xsheetTableBody) return;
        const totalRows = xsheetTableBody.querySelectorAll('tr[data-frame]').length;
        
        const rowHeight = firstCell.offsetHeight; 
        const totalHeight = totalRows * rowHeight;

        const absoluteCellLeft = cellRect.left + window.scrollX;
        const absoluteCellTop = cellRect.top + window.scrollY;

        activeWaveformContainer.style.left = (absoluteCellLeft -1) + 'px'; // -1 for border
        activeWaveformContainer.style.top = absoluteCellTop + 'px';
        activeWaveformContainer.style.width = cellRect.width + 'px';
        activeWaveformContainer.style.height = totalHeight + 'px';

        const canvas = activeWaveformContainer.querySelector('.waveform-canvas');
        const overlay = activeWaveformContainer.querySelector('.waveform-overlay');
        if (canvas) {
            if (canvas.width !== cellRect.width || canvas.height !== totalHeight) {
                canvas.width = cellRect.width;
                canvas.height = totalHeight;
                // Redraw waveform content if dimensions changed
                drawWaveformOnCanvas(canvas, state.waveformData, state.audioBuffer.duration);
            }
        }
        if (overlay) {
            overlay.style.height = totalHeight + 'px';
        }
        renderPhoneticMarkers();
        updateFrameMarker();
    }

    function renderPhoneticMarkers() {
        if (!activeWaveformContainer || !state.phonetics || !state.audioBuffer) return;
        
        // Clear existing labels first to prevent duplicates
        const existingLabels = activeWaveformContainer.querySelectorAll('.phonetic-label');
        existingLabels.forEach(label => label.remove());

        const containerHeight = activeWaveformContainer.offsetHeight;
        
        state.phonetics.forEach((phonetic, index) => {
            const percentage = phonetic.time / state.audioBuffer.duration;
            const yPosition = percentage * containerHeight;
            
            const label = document.createElement('div');
            label.className = 'phonetic-label';
            label.textContent = phonetic.text;
            label.style.position = 'absolute';
            label.style.left = '2px';
            label.style.top = Math.max(0, Math.min(yPosition, containerHeight - label.offsetHeight)) + 'px'; // Clamp to bounds
            label.style.zIndex = '25';
            
            label.addEventListener('dblclick', function() {
                showPhoneticInput(phonetic.time, phonetic.text, index); // Pass index
            });
            activeWaveformContainer.appendChild(label);
        });
    }
    
    function updateFrameMarker() {
        if (!activeWaveformContainer || !state.audioBuffer) return;
        
        const existingMarkers = activeWaveformContainer.querySelectorAll('.waveform-marker');
        existingMarkers.forEach(marker => marker.remove());
        
        const time = state.isPlaying ? (state.audioContext.currentTime - state.startTime + state.startOffset) : state.startOffset;
        const frame = Math.floor(time / state.frameDuration) + 1;
        state.currentFrame = frame;
        
        const containerHeight = activeWaveformContainer.offsetHeight;
        const percentage = time / state.audioBuffer.duration;
        const yPosition = Math.max(0, Math.min(percentage * containerHeight, containerHeight)); // Clamp
        
        const marker = document.createElement('div');
        marker.className = 'waveform-marker';
        marker.style.position = 'absolute';
        marker.style.top = yPosition + 'px';
        marker.style.left = '0';
        marker.style.width = '100%';
        marker.style.height = '2px';
        marker.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
        marker.style.zIndex = '30';
        marker.textContent = `Frame ${frame}`;
        marker.style.lineHeight = '0'; // Adjust text position if needed
        marker.style.textAlign = 'right';
        marker.style.color = 'red';
        marker.style.fontWeight = 'bold';
        marker.style.fontSize = '8pt';
        activeWaveformContainer.appendChild(marker);
        
        if (state.isPlaying) {
            const table = document.getElementById('xsheet-table');
            if (table) {
                 const tableRect = table.getBoundingClientRect(); // Viewport relative
                 const markerAbsoluteY = activeWaveformContainer.getBoundingClientRect().top + yPosition; // Marker's Y relative to viewport

                 if (markerAbsoluteY < tableRect.top || markerAbsoluteY > tableRect.bottom) {
                    // Scroll if marker is outside the visible part of the table area
                    // This scrolling needs to be relative to the window scroll position
                    const scrollTargetY = window.scrollY + markerAbsoluteY - (window.innerHeight / 2);
                     window.scrollTo({ top: scrollTargetY, behavior: 'smooth' });
                 }
            }
        }
        
        elements.audioScrubber.value = (time / state.audioBuffer.duration) * 100;
        if (state.isPlaying) {
            requestAnimationFrame(updateFrameMarker);
        }
    }
    
    function togglePlayAudio() {
        if (!state.audioContext && state.audioBuffer) { // If context was lost (e.g. suspended)
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (state.audioContext && state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }

        if (state.isPlaying) pauseAudio();
        else playAudio();
    }
    
    function playAudio() {
        if (!state.audioBuffer || !state.audioContext) return;
        
        state.audioSource = state.audioContext.createBufferSource();
        state.audioSource.buffer = state.audioBuffer;
        state.audioSource.connect(state.audioContext.destination);
        state.startTime = state.audioContext.currentTime;
        
        state.audioSource.start(0, state.startOffset % state.audioBuffer.duration); // Modulo for looping/restart
        state.isPlaying = true;
        updateFrameMarker();
        elements.playAudioButton.textContent = 'Pause';
        state.audioSource.onended = function() {
            if (state.isPlaying) { // Only stop if it wasn't manually stopped/paused
                // If startOffset reached duration, effectively stopped.
                // Don't call stopAudio() if we want it to naturally end,
                // unless stopAudio handles UI reset for natural end.
                // For now, let's assume it should reset UI.
                stopAudio(); 
            }
        };
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
            try { state.audioSource.stop(); } catch (e) { /* ignore */ }
        }
        state.isPlaying = false;
        state.startOffset = 0;
        elements.playAudioButton.textContent = 'Play';
        elements.audioScrubber.value = 0;
        updateFrameMarker(); // Reset marker to start
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
    
    function showPhoneticInput(time, initialText = '', editIndex = -1) {
        if (time === null) {
            time = state.isPlaying ? (state.audioContext.currentTime - state.startTime + state.startOffset) : state.startOffset;
        }
        state.phoneticEditPosition = { time: time, editIndex: editIndex };
        elements.phoneticText.value = initialText;
        
        if (activeWaveformContainer) {
            const containerRect = activeWaveformContainer.getBoundingClientRect(); // Viewport relative
            const percentage = time / state.audioBuffer.duration;
            const yPositionInContainer = percentage * containerRect.height;
            // Position input relative to viewport, next to waveform marker
            elements.phoneticInput.style.top = (containerRect.top + yPositionInContainer + window.scrollY) + 'px';
            elements.phoneticInput.style.left = (containerRect.right + window.scrollX + 5) + 'px';
        } else {
            elements.phoneticInput.style.top = '200px'; // Fallback
            elements.phoneticInput.style.left = '200px';
        }
        elements.phoneticInput.style.display = 'block';
        elements.phoneticText.focus();
    }
    
    function savePhoneticMarker() {
        if (!state.phoneticEditPosition) return;
        const text = elements.phoneticText.value.trim();
        if (text === '') {
            if (state.phoneticEditPosition.editIndex >= 0) {
                state.phonetics.splice(state.phoneticEditPosition.editIndex, 1);
            }
        } else {
            if (state.phoneticEditPosition.editIndex >= 0) {
                state.phonetics[state.phoneticEditPosition.editIndex].text = text;
                // Time doesn't change on edit, only text
            } else {
                state.phonetics.push({ time: state.phoneticEditPosition.time, text: text });
                // Sort phonetics by time to ensure correct order if added out of sequence
                state.phonetics.sort((a, b) => a.time - b.time);
            }
        }
        elements.phoneticInput.style.display = 'none';
        renderPhoneticMarkers(); // Re-render all markers (renderWaveform implicitly calls this)
        if(app.state) app.state.modified = true;
    }
    
    function drawWaveformInCells() {
        const waveformCells = document.querySelectorAll('#xsheet-body .waveform-col'); // More specific selector
        if (waveformCells.length === 0 || !state.audioBuffer || state.waveformData.length === 0) return;

        const totalAudioDuration = state.audioBuffer.duration;
        const pointsPerFrame = state.waveformData.length / (totalAudioDuration * 24); // Assuming 24fps

        waveformCells.forEach((cell, index) => {
            cell.setAttribute('data-original-content', cell.innerHTML);
            const frameNum = parseInt(cell.parentElement.getAttribute('data-frame')); // Get frame from parent TR
            if (isNaN(frameNum)) return;

            const canvas = document.createElement('canvas');
            // Ensure canvas is sized AFTER it's in the DOM and styles are applied to cell for accurate measures
            // For now, we use offsetWidth/Height directly. If issues, defer sizing.
            canvas.width = cell.offsetWidth;
            canvas.height = cell.offsetHeight;
            if(canvas.width === 0 || canvas.height === 0) return; // Skip if cell has no dimensions (e.g. hidden)

            canvas.style.display = 'block';
            // CSS width/height not needed if attributes are set correctly and display is block

            const ctx = canvas.getContext('2d', { alpha: true });
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent background

            // Draw center line
            ctx.beginPath();
            ctx.strokeStyle = '#cccccc';
            ctx.moveTo(canvas.width / 2, 0);
            ctx.lineTo(canvas.width / 2, canvas.height);
            ctx.stroke();

            const startPoint = Math.floor((frameNum - 1) * pointsPerFrame);
            const endPoint = Math.floor(frameNum * pointsPerFrame);

            if (startPoint < state.waveformData.length && endPoint > startPoint) {
                ctx.beginPath();
                ctx.strokeStyle = '#000000';
                for (let i = startPoint; i <= endPoint && i < state.waveformData.length; i++) {
                    const relativePos = (i - startPoint) / (endPoint - startPoint);
                    const y = relativePos * canvas.height;
                    const amplitude = state.waveformData[i] * (canvas.width * 0.4);
                    const x = (canvas.width / 2) + amplitude;
                    if (i === startPoint) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                for (let i = endPoint; i >= startPoint && i < state.waveformData.length; i--) {
                    const relativePos = (i - startPoint) / (endPoint - startPoint);
                    const y = relativePos * canvas.height;
                    const amplitude = state.waveformData[i] * (canvas.width * 0.4);
                    const x = (canvas.width / 2) - amplitude;
                    ctx.lineTo(x, y);
                }
                ctx.stroke();

                if (state.phonetics && state.phonetics.length > 0) {
                    state.phonetics.forEach(phonetic => {
                        const frameOfMarker = Math.floor(phonetic.time / state.frameDuration) + 1;
                        if (frameOfMarker === frameNum) {
                            const posInFrameRatio = (phonetic.time - ((frameNum - 1) * state.frameDuration)) / state.frameDuration;
                            const yPos = Math.min(canvas.height - 1, Math.max(1, posInFrameRatio * canvas.height));
                            ctx.beginPath();
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineWidth = 1;
                            ctx.moveTo(0, yPos);
                            ctx.lineTo(canvas.width, yPos);
                            ctx.stroke();
                            if (canvas.width > 30) {
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                                const textWidth = ctx.measureText(phonetic.text).width;
                                if (textWidth < canvas.width - 4) {
                                    ctx.fillRect(2, Math.max(0, yPos - 8), textWidth + 4, 14); // Ensure within bounds
                                    ctx.fillStyle = '#ff0000';
                                    ctx.font = '8px Arial';
                                    ctx.fillText(phonetic.text, 4, Math.min(canvas.height - 2, yPos + 4)); // Ensure within bounds
                                }
                            }
                        }
                    });
                }
            }
            // Frame number (already present in table, maybe not needed here unless for debug)
            // ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.font = '8px Arial'; ctx.fillText(frameNum, 2, 8);

            cell.innerHTML = ''; // Clear previous content
            cell.appendChild(canvas);
        });
    }
    
    const api = {
        init,
        drawWaveformInCells,
        togglePlayAudio,
        stopAudio,
        state // Expose state for debugging or other modules if necessary
    };
    
    app.Audio = api;
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);

//--- END OF FILE audio.js ---