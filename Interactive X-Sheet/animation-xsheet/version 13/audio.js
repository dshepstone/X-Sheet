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
        audioData: null,
        isPlaying: false,
        startTime: 0,
        startOffset: 0,
        audioFileName: '',
        waveformData: [],
        waveformCanvases: [],
        phonetics: [],
        frameDuration: 1 / 24, // 24fps
        currentFrame: 0,
        phoneticEditPosition: null
    };
    
    // DOM Elements
    let elements = {};
    
    // Initialize audio module
    function init() {
        // Cache DOM elements
        cacheElements();
        
        // Set up event listeners
        setupEventListeners();
        
        // Listen for app events
        listenForAppEvents();
    }
    
    // Cache DOM elements
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
    
    // Set up event listeners
    function setupEventListeners() {
        // Audio file upload
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
        
        // Audio playback controls
        elements.playAudioButton.addEventListener('click', togglePlayAudio);
        elements.stopAudioButton.addEventListener('click', stopAudio);
        elements.audioScrubber.addEventListener('input', scrubAudio);
        
        // Phonetic marker controls
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
    
    // Listen for app-wide events
    function listenForAppEvents() {
        // Table has been updated - re-render waveform
        document.addEventListener('xsheet-updated', function() {
            if (state.audioBuffer) {
                renderWaveform();
            }
        });
        
        // Frame count has changed - re-render waveform
        document.addEventListener('xsheet-framecount-changed', function() {
            if (state.audioBuffer) {
                renderWaveform();
            }
        });
        
        // Template has changed - re-render waveform
        document.addEventListener('xsheet-template-changed', function() {
            if (state.audioBuffer) {
                renderWaveform();
            }
        });
        
        // Clear sheet - reset audio
        document.addEventListener('xsheet-clear', function() {
            // Clear audio
            state.audioBuffer = null;
            state.audioSource = null;
            state.waveformData = [];
            state.phonetics = [];
            state.audioFileName = '';
            elements.audioInfo.textContent = 'No audio loaded';
            
            // Stop any playing audio
            stopAudio();
            
            // Clear waveform visualization
            state.waveformCanvases.forEach(canvas => {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
            
            // Clear phonetic markers
            const labels = document.querySelectorAll('.phonetic-label');
            labels.forEach(label => label.remove());
            
            // Clear any waveform containers
            const waveformContainer = document.querySelector('.waveform-container');
            if (waveformContainer) {
                waveformContainer.remove();
            }
        });
        
        // Data collection for saving
        document.addEventListener('xsheet-collect-data', function(e) {
            if (e.detail && e.detail.data) {
                // Add audio data to save data
                e.detail.data.audio = {
                    fileName: state.audioFileName,
                    phonetics: state.phonetics
                };
            }
        });
        
        // Data restoration when loading
        document.addEventListener('xsheet-restore-data', function(e) {
            if (e.detail && e.detail.data && e.detail.data.audio) {
                state.audioFileName = e.detail.data.audio.fileName || '';
                state.phonetics = e.detail.data.audio.phonetics || [];
                
                if (state.audioBuffer && state.phonetics.length > 0) {
                    renderWaveform();
                }
            }
        });
    }
    
    // Load audio file and decode
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
        
        reader.onload = function(e) {
            const audioData = e.target.result;
            
            // Update status
            app.updateStatusMessage('Decoding audio...');
            
            // Decode the audio data
            state.audioContext.decodeAudioData(audioData, 
                function(buffer) {
                    // Success handler
                    state.audioBuffer = buffer;
                    
                    // Update audio info
                    const duration = buffer.duration;
                    const minutes = Math.floor(duration / 60);
                    const seconds = Math.floor(duration % 60);
                    const frameCount = Math.ceil(duration * 24); // Assuming 24fps
                    
                    elements.audioInfo.textContent = `${state.audioFileName} (${minutes}:${seconds.toString().padStart(2, '0')}, ${frameCount} frames @ 24fps)`;
                    
                    // Enable audio controls
                    elements.playAudioButton.disabled = false;
                    elements.stopAudioButton.disabled = false;
                    elements.audioScrubber.disabled = false;
                    
                    // Generate waveform visualization
                    generateWaveformData(buffer);
                    
                    // Update status
                    app.updateStatusMessage('Audio loaded: ' + state.audioFileName);
                    
                    // If the x-sheet has fewer frames than the audio, suggest increasing
                    if (frameCount > app.state.frameCount) {
                        if (confirm(`This audio is ${frameCount} frames long at 24fps, but your X-sheet only has ${app.state.frameCount} frames. Do you want to increase the frame count?`)) {
                            app.state.frameCount = frameCount;
                            document.getElementById('frame-count').value = frameCount;
                            app.generateTable(frameCount);
                            renderWaveform();
                        } else {
                            renderWaveform();
                        }
                    } else {
                        renderWaveform();
                    }
                }, 
                function(e) {
                    // Error handler with better feedback
                    console.error('Audio decoding error:', e);
                    app.updateStatusMessage('Error decoding audio: ' + (e.message || 'Format may be unsupported'));
                }
            );
        };
        
        reader.onerror = function() {
            app.updateStatusMessage('Error reading audio file');
        };
        
        reader.readAsArrayBuffer(file);
    }
    
    // Generate waveform data from audio buffer
    function generateWaveformData(buffer) {
        // Get the raw audio data from the buffer
        const rawData = buffer.getChannelData(0); // Use first channel
        
        // Calculate how many samples we need for our visualization
        const totalSamples = rawData.length;
        
        // Process for visualization - we need to reduce the resolution
        // to make it efficient to display
        state.waveformData = [];
        
        // Calculate desired number of points for the visualization
        // For vertical waveform, we want more detail
        const pointsPerSecond = 100; // Increase detail for vertical display
        const totalPoints = Math.ceil(buffer.duration * pointsPerSecond);
        
        // Calculate step size
        const step = Math.floor(totalSamples / totalPoints);
        
        // Build the waveform data array
        for (let i = 0; i < totalPoints; i++) {
            const index = Math.floor(i * step);
            if (index < totalSamples) {
                // Get the absolute value for a nicer visual
                state.waveformData.push(Math.abs(rawData[index]));
            }
        }
    }
    
    // Render waveform on screen
    function renderWaveform() {
        if (!state.audioBuffer || state.waveformData.length === 0) return;
        
        // Clear existing markers and components
        const existingMarkers = document.querySelectorAll('.waveform-marker');
        existingMarkers.forEach(marker => marker.remove());
        
        const existingLabels = document.querySelectorAll('.phonetic-label');
        existingLabels.forEach(label => label.remove());
        
        const existingContainer = document.querySelector('.waveform-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        
        // Get the table and first waveform column cell for positioning
        const table = document.getElementById('xsheet-table');
        const firstCell = document.querySelector('.waveform-col[data-frame="1"]');
        if (!firstCell) return;
        
        // Calculate total height needed for the waveform
        const totalRows = document.querySelectorAll('tr[data-frame]').length;
        const rowHeight = firstCell.offsetHeight;
        const totalHeight = totalRows * rowHeight;
        
        // Create a container for the vertical waveform that spans the entire table
        const waveformContainer = document.createElement('div');
        waveformContainer.className = 'waveform-container';
        
        // Create a canvas for the waveform
        const canvas = document.createElement('canvas');
        canvas.className = 'waveform-canvas';
        canvas.width = firstCell.offsetWidth;
        canvas.height = totalHeight;
        waveformContainer.appendChild(canvas);
        
        // Add overlay for event handling
        const overlay = document.createElement('div');
        overlay.className = 'waveform-overlay';
        overlay.style.height = totalHeight + 'px';
        
        // Add event listener for clicking on the waveform
        overlay.addEventListener('click', function(e) {
            if (!state.audioBuffer) return;
            
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const percentage = y / rect.height;
            
            // Calculate time point in the audio
            const timePoint = percentage * state.audioBuffer.duration;
            
            // Update audio position
            elements.audioScrubber.value = (timePoint / state.audioBuffer.duration) * 100;
            if (state.isPlaying) {
                stopAudio();
                state.startOffset = timePoint;
                playAudio();
            } else {
                state.startOffset = timePoint;
            }
            
            // Update the UI to show frame position
            updateFrameMarker();
        });
        
        // Variables for scrubbing
        let isScrubbing = false;
        
        // Add scrubbing functionality (dragging while holding mouse button)
        overlay.addEventListener('mousedown', function(e) {
            if (!state.audioBuffer) return;
            if (e.button !== 0) return; // Only respond to left mouse button
            
            isScrubbing = true;
            
            // Pause any playing audio
            if (state.isPlaying) {
                pauseAudio();
            }
            
            // Create a scrub audio context if needed
            if (!state.audioContext) {
                try {
                    window.AudioContext = window.AudioContext || window.webkitAudioContext;
                    state.audioContext = new AudioContext();
                } catch (e) {
                    console.error('Web Audio API not supported');
                    return;
                }
            }
            
            // Initial scrub to current position
            updateScrubPosition(e);
            
            // Prevent text selection during drag
            e.preventDefault();
        });
        
        // Handle pen input for tablets
        overlay.addEventListener('pointerdown', function(e) {
            if (!state.audioBuffer || e.pointerType !== 'pen') return;
            isScrubbing = true;
            if (state.isPlaying) pauseAudio();
            updateScrubPosition(e);
            e.preventDefault();
        });
        
        overlay.addEventListener('pointermove', function(e) {
            if (isScrubbing && e.pointerType === 'pen' && e.pressure > 0) {
                updateScrubPosition(e);
            }
        });
        
        overlay.addEventListener('pointerup', function(e) {
            if (e.pointerType === 'pen') {
                isScrubbing = false;
            }
        });
        
        // Handle scrubbing movement
        overlay.addEventListener('mousemove', function(e) {
            if (!isScrubbing || !state.audioBuffer) return;
            updateScrubPosition(e);
        });
        
        // Function to update position during scrubbing
        function updateScrubPosition(e) {
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const percentage = Math.max(0, Math.min(1, y / rect.height));
            
            // Calculate time point in the audio
            const timePoint = percentage * state.audioBuffer.duration;
            state.startOffset = timePoint;
            
            // Update audio scrubber
            elements.audioScrubber.value = percentage * 100;
            
            // Play a short snippet of audio at this position
            playScrubAudio(timePoint);
            
            // Update the marker
            updateFrameMarker();
        }
        
        // End scrubbing when mouse is released or leaves element
        overlay.addEventListener('mouseup', function() {
            isScrubbing = false;
        });
        
        overlay.addEventListener('mouseleave', function() {
            isScrubbing = false;
        });
        
        // Function to play a short snippet at the scrub position
        let scrubSource = null;
        function playScrubAudio(timePoint) {
            if (scrubSource) {
                try {
                    scrubSource.stop();
                } catch (e) {
                    // Ignore errors when stopping already stopped source
                }
            }
            
            // Play a very short snippet at the current position
            scrubSource = state.audioContext.createBufferSource();
            scrubSource.buffer = state.audioBuffer;
            scrubSource.connect(state.audioContext.destination);
            
            // Play just a short snippet (equivalent to 1-2 frames at 24fps)
            const snippetDuration = 1 / 12; // 1/12 of a second (2 frames at 24fps)
            scrubSource.start(0, timePoint, snippetDuration);
        }
        
        // Right-click to add phonetic marker
        overlay.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            if (!state.audioBuffer) return;
            
            const rect = overlay.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const percentage = y / rect.height;
            
            // Calculate time point in the audio
            const timePoint = percentage * state.audioBuffer.duration;
            
            showPhoneticInput(timePoint);
            return false;
        });
        
        waveformContainer.appendChild(overlay);
        
        // Add the container to the table
        document.body.appendChild(waveformContainer);
        
        // Position the container over the waveform column
        const tableRect = table.getBoundingClientRect();
        const cellRect = firstCell.getBoundingClientRect();
        
        waveformContainer.style.left = (cellRect.left - 1) + 'px';
        waveformContainer.style.top = (cellRect.top) + 'px';
        waveformContainer.style.width = (cellRect.width) + 'px';
        waveformContainer.style.height = totalHeight + 'px';
        
        // Draw the waveform on the canvas
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear and set background
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        
        // Calculate scaling factors
        const totalDuration = state.audioBuffer.duration;
        const framesPerSecond = 24;
        const totalFrames = Math.ceil(totalDuration * framesPerSecond);
        
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
        
        // Map waveform data to vertical height
        for (let i = 0; i < state.waveformData.length; i++) {
            const y = (i / state.waveformData.length) * height;
            const amplitude = state.waveformData[i] * (width * 0.4); // Scale amplitude to 40% of width
            const x = (width / 2) + amplitude;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        // Draw mirrored waveform for visual effect
        for (let i = state.waveformData.length - 1; i >= 0; i--) {
            const y = (i / state.waveformData.length) * height;
            const amplitude = state.waveformData[i] * (width * 0.4);
            const x = (width / 2) - amplitude;
            
            ctx.lineTo(x, y);
        }
        
        ctx.stroke();
        
        // Draw frame markers
        for (let i = 1; i <= totalFrames && i <= totalRows; i++) {
            const y = (i / totalRows) * height;
            
            // Draw horizontal line at frame boundary
            if (i % 8 === 0) {
                ctx.beginPath();
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = 1;
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        }
        
        // Render phonetic markers
        renderPhoneticMarkers();
        
        // Add the moving marker for current frame
        updateFrameMarker();
    }
    
    // Render phonetic markers on the waveform
    function renderPhoneticMarkers() {
        if (!state.phonetics || !state.audioBuffer) return;
        
        // Get the waveform container
        const waveformContainer = document.querySelector('.waveform-container');
        if (!waveformContainer) return;
        
        // Get container dimensions
        const containerHeight = waveformContainer.offsetHeight;
        
        // Add phonetic markers
        state.phonetics.forEach(phonetic => {
            // Calculate vertical position based on time
            const percentage = phonetic.time / state.audioBuffer.duration;
            const yPosition = percentage * containerHeight;
            
            // Create and position the marker
            const label = document.createElement('div');
            label.className = 'phonetic-label';
            label.textContent = phonetic.text;
            label.style.position = 'absolute';
            label.style.left = '2px';
            label.style.top = yPosition + 'px';
            label.style.zIndex = '25';
            
            // Add event listener to edit the phonetic marker
            label.addEventListener('dblclick', function() {
                showPhoneticInput(phonetic.time, phonetic.text, state.phonetics.indexOf(phonetic));
            });
            
            waveformContainer.appendChild(label);
        });
    }
    
    // Update the marker showing current playback position
    function updateFrameMarker() {
        if (!state.audioBuffer) return;
        
        // Remove existing markers
        const existingMarkers = document.querySelectorAll('.waveform-marker');
        existingMarkers.forEach(marker => marker.remove());
        
        // Calculate which frame we're on
        const time = state.isPlaying ?
            (state.audioContext.currentTime - state.startTime + state.startOffset) :
            state.startOffset;
        
        const frame = Math.floor(time / state.frameDuration) + 1;
        state.currentFrame = frame;
        
        // Get the waveform container
        const waveformContainer = document.querySelector('.waveform-container');
        if (!waveformContainer) return;
        
        // Calculate vertical position based on time
        const containerHeight = waveformContainer.offsetHeight;
        const percentage = time / state.audioBuffer.duration;
        const yPosition = percentage * containerHeight;
        
        // Create horizontal marker line
        const marker = document.createElement('div');
        marker.className = 'waveform-marker';
        marker.style.position = 'absolute';
        marker.style.top = yPosition + 'px';
        marker.style.left = '0';
        marker.style.width = '100%';
        marker.style.height = '2px';
        marker.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
        marker.style.zIndex = '30';
        
        // Add frame number
        marker.textContent = `Frame ${frame}`;
        marker.style.lineHeight = '0';
        marker.style.textAlign = 'right';
        marker.style.color = 'red';
        marker.style.fontWeight = 'bold';
        marker.style.fontSize = '8pt';
        
        waveformContainer.appendChild(marker);
        
        // Scroll to the marker if it's not visible and if we're playing
        if (state.isPlaying) {
            const table = document.getElementById('xsheet-table');
            const tableRect = table.getBoundingClientRect();
            const markerY = tableRect.top + yPosition;
            
            // Check if marker is outside visible area
            if (markerY < window.scrollY || markerY > window.scrollY + window.innerHeight) {
                window.scrollTo({
                    top: markerY - (window.innerHeight / 2),
                    behavior: 'smooth'
                });
            }
        }
        
        // Update scrubber position
        if (state.audioBuffer) {
            const scrubPercentage = (time / state.audioBuffer.duration) * 100;
            elements.audioScrubber.value = scrubPercentage;
        }
        
        // If playing, schedule the next update
        if (state.isPlaying) {
            requestAnimationFrame(updateFrameMarker);
        }
    }
    
    // Toggle audio playback between play and pause
    function togglePlayAudio() {
        if (state.isPlaying) {
            pauseAudio();
        } else {
            playAudio();
        }
    }
    
    // Play audio from current position
    function playAudio() {
        if (!state.audioBuffer) return;
        
        try {
            // Create a new source node
            state.audioSource = state.audioContext.createBufferSource();
            state.audioSource.buffer = state.audioBuffer;
            state.audioSource.connect(state.audioContext.destination);
            
            // Calculate start position
            state.startTime = state.audioContext.currentTime;
            
            // Start playback from the current offset
            state.audioSource.start(0, state.startOffset);
            state.isPlaying = true;
            
            // Set up animation loop
            updateFrameMarker();
            
            // Update UI
            elements.playAudioButton.textContent = 'Pause';
            
            // Set up ended event
            state.audioSource.onended = function() {
                if (state.isPlaying) {
                    stopAudio();
                }
            };
        } catch (e) {
            app.updateStatusMessage('Error playing audio: ' + e.message);
        }
    }
    
    // Pause audio playback
    function pauseAudio() {
        if (!state.isPlaying || !state.audioSource) return;
        
        // Stop the audio
        state.audioSource.stop();
        
        // Calculate current position
        state.startOffset += state.audioContext.currentTime - state.startTime;
        
        state.isPlaying = false;
        
        // Update UI
        elements.playAudioButton.textContent = 'Play';
    }
    
    // Stop audio playback and reset position
    function stopAudio() {
        if (state.audioSource) {
            try {
                state.audioSource.stop();
            } catch (e) {
                // Ignore errors when stopping already stopped source
            }
        }
        
        state.isPlaying = false;
        state.startOffset = 0;
        
        // Update UI
        elements.playAudioButton.textContent = 'Play';
        elements.audioScrubber.value = 0;
        
        // Clear frame marker
        updateFrameMarker();
    }
    
    // Scrub to a position based on scrubber input
    function scrubAudio() {
        if (!state.audioBuffer) return;
        
        // Calculate time from scrubber position
        const percentage = elements.audioScrubber.value / 100;
        const newTime = percentage * state.audioBuffer.duration;
        
        // If playing, restart from new position
        if (state.isPlaying) {
            pauseAudio();
            state.startOffset = newTime;
            playAudio();
        } else {
            state.startOffset = newTime;
            updateFrameMarker();
        }
    }
    
    // Show phonetic input interface at specified position
    function showPhoneticInput(time, initialText = '', editIndex = -1) {
        if (time === null) {
            // If no time provided, use current position
            time = state.isPlaying ?
                (state.audioContext.currentTime - state.startTime + state.startOffset) :
                state.startOffset;
        }
        
        // Store position for later use
        state.phoneticEditPosition = {
            time: time,
            editIndex: editIndex
        };
        
        // Set initial text if editing existing marker
        elements.phoneticText.value = initialText;
        
        // Get the waveform container and calculate position
        const waveformContainer = document.querySelector('.waveform-container');
        if (waveformContainer) {
            const containerRect = waveformContainer.getBoundingClientRect();
            const containerHeight = waveformContainer.offsetHeight;
            const percentage = time / state.audioBuffer.duration;
            const yPosition = percentage * containerHeight;
            
            // Position the input near the click position
            elements.phoneticInput.style.top = (containerRect.top + yPosition + window.scrollY) + 'px';
            elements.phoneticInput.style.left = (containerRect.right + window.scrollX + 5) + 'px';
        } else {
            // Default position if container not found
            elements.phoneticInput.style.top = '200px';
            elements.phoneticInput.style.left = '200px';
        }
        
        // Show the input and focus it
        elements.phoneticInput.style.display = 'block';
        elements.phoneticText.focus();
    }
    
    // Save or update phonetic marker
    function savePhoneticMarker() {
        if (!state.phoneticEditPosition) return;
        
        const text = elements.phoneticText.value.trim();
        if (text === '') {
            // If empty text and editing an existing marker, remove it
            if (state.phoneticEditPosition.editIndex >= 0) {
                state.phonetics.splice(state.phoneticEditPosition.editIndex, 1);
            }
        } else {
            // Save or update the phonetic marker
            if (state.phoneticEditPosition.editIndex >= 0) {
                // Update existing
                state.phonetics[state.phoneticEditPosition.editIndex].text = text;
            } else {
                // Add new
                state.phonetics.push({
                    time: state.phoneticEditPosition.time,
                    text: text
                });
            }
        }
        
        // Hide input
        elements.phoneticInput.style.display = 'none';
        
        // Re-render markers
        renderWaveform();
        
        // Mark as modified
        app.state.modified = true;
    }
    
    // Generate cell-based waveforms for print/export
    // In audio.js - update the drawWaveformInCells function
    function drawWaveformInCells() {
        const waveformCells = document.querySelectorAll('.waveform-col');
        if (waveformCells.length === 0 || !state.audioBuffer || state.waveformData.length === 0) return;

        // Calculate the number of data points per frame
        const totalDuration = state.audioBuffer.duration;
        const pointsPerFrame = state.waveformData.length / (totalDuration * 24);

        // For each cell, draw its portion of the waveform
        waveformCells.forEach((cell, index) => {
            // Store original content if any
            cell.setAttribute('data-original-content', cell.innerHTML);

            // Get the frame number (1-based)
            const frameNum = index + 1;

            // Create a canvas for this cell with precise dimensions
            const canvas = document.createElement('canvas');
            canvas.width = cell.offsetWidth;
            canvas.height = cell.offsetHeight;
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.margin = '0';
            canvas.style.padding = '0';

            const ctx = canvas.getContext('2d', { alpha: true });

            // Use transparent background
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw center line
            ctx.beginPath();
            ctx.strokeStyle = '#cccccc';
            ctx.moveTo(canvas.width / 2, 0);
            ctx.lineTo(canvas.width / 2, canvas.height);
            ctx.stroke();

            // Calculate which section of the waveform to draw
            const startPoint = Math.floor((frameNum - 1) * pointsPerFrame);
            const endPoint = Math.floor(frameNum * pointsPerFrame);

            if (startPoint < state.waveformData.length) {
                // Draw this portion of the waveform with improved positioning
                ctx.beginPath();
                ctx.strokeStyle = '#000000';

                // Check if we have valid data to draw
                if (endPoint > startPoint) {
                    // Map the waveform section to this cell with better vertical alignment
                    for (let i = startPoint; i <= endPoint && i < state.waveformData.length; i++) {
                        // Calculate position within this cell
                        const relativePos = (i - startPoint) / Math.max(1, endPoint - startPoint);
                        const y = relativePos * canvas.height;

                        // Draw waveform
                        const amplitude = state.waveformData[i] * (canvas.width * 0.4);
                        const x = (canvas.width / 2) + amplitude;

                        if (i === startPoint) {
                            ctx.moveTo(x, y);
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }

                    // Draw left side (mirror)
                    for (let i = endPoint; i >= startPoint && i < state.waveformData.length; i--) {
                        const relativePos = (i - startPoint) / Math.max(1, endPoint - startPoint);
                        const y = relativePos * canvas.height;

                        const amplitude = state.waveformData[i] * (canvas.width * 0.4);
                        const x = (canvas.width / 2) - amplitude;

                        ctx.lineTo(x, y);
                    }

                    ctx.stroke();
                }

                // Look for phonetic markers that might be in this frame
                if (state.phonetics && state.phonetics.length > 0) {
                    state.phonetics.forEach(phonetic => {
                        // Calculate which frame this phonetic marker belongs to
                        const frameOfMarker = Math.floor(phonetic.time / state.frameDuration) + 1;

                        // If it's in this frame, draw it with improved positioning
                        if (frameOfMarker === frameNum) {
                            // Calculate position within cell with better precision
                            const posInFrameRatio = (phonetic.time - ((frameNum - 1) * state.frameDuration)) / state.frameDuration;
                            const yPos = Math.min(canvas.height - 1, Math.max(1, posInFrameRatio * canvas.height));

                            // Draw marker line
                            ctx.beginPath();
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineWidth = 1;
                            ctx.moveTo(0, yPos);
                            ctx.lineTo(canvas.width, yPos);
                            ctx.stroke();

                            // Add label if it fits
                            if (canvas.width > 30) {
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                                const textWidth = ctx.measureText(phonetic.text).width;
                                if (textWidth < canvas.width - 4) {
                                    ctx.fillRect(2, yPos - 8, textWidth + 4, 14);
                                    ctx.fillStyle = '#ff0000';
                                    ctx.font = '8px Arial';
                                    ctx.fillText(phonetic.text, 4, yPos + 4);
                                }
                            }
                        }
                    });
                }
            }

            // Add frame number indicator
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.fillRect(0, 0, 18, 12);
            ctx.fillStyle = '#000000';
            ctx.font = '8px Arial';
            ctx.fillText(frameNum, 2, 8);

            // Clear cell content and add the canvas
            cell.innerHTML = '';
            cell.appendChild(canvas);
        });
    }
    
    // Public API
    const api = {
        init,
        drawWaveformInCells,
        togglePlayAudio,
        stopAudio,
        state
    };
    
    // Expose API
    app.Audio = api;
    
    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);
